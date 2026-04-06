import type {
  BeamModMetadata,
  RegistryRelationshipDescriptor,
  RegistryRelationship,
  RegistryAnyOfRelationship,
  ResolutionResult
} from '../../shared/registry-types'
import type { RegistryService } from './RegistryService'

/**
 * Dependency resolver for BeamNG mods.
 * Modeled after CKAN's RelationshipResolver — walks the dependency graph,
 * detects conflicts, and computes a changeset.
 */
export class DependencyResolver {
  constructor(
    private registry: RegistryService,
    private options: ResolverOptions = {}
  ) {}

  /**
   * Resolve the full changeset needed to install the given mods.
   * Returns the list of mods to install (in dependency order), plus warnings/errors.
   */
  resolve(requested: BeamModMetadata[]): ResolutionResult {
    const result: ResolutionResult = {
      to_install: [],
      to_remove: [],
      warnings: [],
      errors: [],
      success: true
    }

    // Track what we're planning to install (identifier → metadata)
    const changeset = new Map<string, BeamModMetadata>()
    // Track why each mod was selected
    const reasons = new Map<string, SelectionReason>()
    // Track visited identifiers to break cycles
    const visiting = new Set<string>()

    // Seed with user-requested mods
    for (const mod of requested) {
      if (changeset.has(mod.identifier)) continue
      changeset.set(mod.identifier, mod)
      reasons.set(mod.identifier, 'user-requested')
    }

    // Resolve dependencies for each requested mod
    for (const mod of requested) {
      this.resolveMod(mod, changeset, reasons, visiting, result, 'depends')
      if (this.options.with_recommends !== false) {
        this.resolveMod(mod, changeset, reasons, visiting, result, 'recommends')
      }
      if (this.options.with_suggests) {
        this.resolveMod(mod, changeset, reasons, visiting, result, 'suggests')
      }
    }

    // Check for conflicts across the entire changeset + already-installed mods
    this.checkConflicts(changeset, result)

    // Topological sort for install order
    result.to_install = this.topologicalSort(changeset)
    result.success = result.errors.length === 0

    return result
  }

  /**
   * Check what would break if we removed the given identifiers.
   * Returns identifiers of mods that depend on the ones being removed.
   */
  findReverseDependencies(identifiersToRemove: string[]): string[] {
    const removing = new Set(identifiersToRemove)
    const broken: string[] = []
    const installed = this.registry.getInstalled()

    for (const [id, entry] of Object.entries(installed)) {
      if (removing.has(id)) continue
      const deps = entry.metadata.depends ?? []
      for (const dep of deps) {
        if (this.isAnyOf(dep)) continue
        const rel = dep as RegistryRelationship
        if (removing.has(rel.identifier)) {
          broken.push(id)
          break
        }
      }
    }

    return broken
  }

  // ── Internal Resolution ──

  private resolveMod(
    mod: BeamModMetadata,
    changeset: Map<string, BeamModMetadata>,
    reasons: Map<string, SelectionReason>,
    visiting: Set<string>,
    result: ResolutionResult,
    relType: 'depends' | 'recommends' | 'suggests'
  ): void {
    const relationships = mod[relType]
    if (!relationships || relationships.length === 0) return

    for (const rel of relationships) {
      this.resolveRelationship(rel, mod.identifier, relType, changeset, reasons, visiting, result)
    }
  }

  private resolveRelationship(
    rel: RegistryRelationshipDescriptor,
    parentId: string,
    relType: 'depends' | 'recommends' | 'suggests',
    changeset: Map<string, BeamModMetadata>,
    reasons: Map<string, SelectionReason>,
    visiting: Set<string>,
    result: ResolutionResult
  ): void {
    if (this.isAnyOf(rel)) {
      this.resolveAnyOf(rel as RegistryAnyOfRelationship, parentId, relType, changeset, reasons, visiting, result)
      return
    }

    const descriptor = rel as RegistryRelationship
    const id = descriptor.identifier

    // Already in changeset?
    if (changeset.has(id)) {
      // Check version compatibility with what's already planned
      const existing = changeset.get(id)!
      if (!this.satisfiesRelationship(existing, descriptor)) {
        result.errors.push(
          `Version conflict: "${parentId}" needs ${id} ${this.formatVersionReq(descriptor)}, but ${existing.version} is already selected`
        )
      }
      return
    }

    // Already installed?
    if (this.registry.isInstalled(id)) {
      const installedVer = this.registry.getInstalledVersion(id)!
      if (this.satisfiesVersionString(installedVer, descriptor)) {
        return // Satisfied by installed version
      }
      // Need to upgrade — find a version that satisfies
    }

    // Break dependency cycles
    if (visiting.has(id)) return
    visiting.add(id)

    // Find a candidate
    const candidates = this.registry.getAllProviders(id)
    const match = candidates.find((c) => this.satisfiesRelationship(c, descriptor))

    if (!match) {
      if (relType === 'depends') {
        result.errors.push(
          `Missing dependency: "${parentId}" requires ${id} ${this.formatVersionReq(descriptor)}, but no compatible version was found`
        )
      } else {
        result.warnings.push(
          `Optional ${relType === 'recommends' ? 'recommendation' : 'suggestion'} "${id}" for "${parentId}" is not available`
        )
      }
      visiting.delete(id)
      return
    }

    // Add to changeset
    changeset.set(match.identifier, match)
    reasons.set(match.identifier, relType === 'depends' ? 'dependency' : relType === 'recommends' ? 'recommended' : 'suggested')

    // Recurse into the dependency's own dependencies
    this.resolveMod(match, changeset, reasons, visiting, result, 'depends')
    if (this.options.with_recommends !== false && relType === 'depends') {
      this.resolveMod(match, changeset, reasons, visiting, result, 'recommends')
    }

    visiting.delete(id)
  }

  private resolveAnyOf(
    rel: RegistryAnyOfRelationship,
    parentId: string,
    relType: 'depends' | 'recommends' | 'suggests',
    changeset: Map<string, BeamModMetadata>,
    reasons: Map<string, SelectionReason>,
    visiting: Set<string>,
    result: ResolutionResult
  ): void {
    // Check if any option is already satisfied
    for (const option of rel.any_of) {
      if (changeset.has(option.identifier)) return
      if (this.registry.isInstalled(option.identifier)) {
        const ver = this.registry.getInstalledVersion(option.identifier)!
        if (this.satisfiesVersionString(ver, option)) return
      }
    }

    // Try to resolve the first available option
    for (const option of rel.any_of) {
      const candidates = this.registry.getAllProviders(option.identifier)
      const match = candidates.find((c) => this.satisfiesRelationship(c, option))
      if (match) {
        changeset.set(match.identifier, match)
        reasons.set(match.identifier, 'dependency')
        this.resolveMod(match, changeset, reasons, visiting, result, 'depends')
        return
      }
    }

    // None found
    const options = rel.any_of.map((o) => o.identifier).join(', ')
    if (relType === 'depends') {
      result.errors.push(
        `Missing dependency: "${parentId}" requires one of [${options}], but none are available`
      )
    } else {
      result.warnings.push(
        `Optional: "${parentId}" recommends one of [${options}], but none are available`
      )
    }
  }

  // ── Conflict Detection ──

  private checkConflicts(changeset: Map<string, BeamModMetadata>, result: ResolutionResult): void {
    const installed = this.registry.getInstalled()
    const allMods = new Map<string, BeamModMetadata>()

    // Merge installed + changeset
    for (const [id, entry] of Object.entries(installed)) {
      if (!changeset.has(id)) {
        allMods.set(id, entry.metadata)
      }
    }
    for (const [id, meta] of changeset) {
      allMods.set(id, meta)
    }

    // Check each mod's conflicts list
    for (const [id, meta] of allMods) {
      if (!meta.conflicts) continue
      for (const conflict of meta.conflicts) {
        if (this.isAnyOf(conflict)) continue
        const rel = conflict as RegistryRelationship
        const conflicting = allMods.get(rel.identifier)
        if (conflicting && this.satisfiesRelationship(conflicting, rel)) {
          result.errors.push(
            `Conflict: "${id}" conflicts with "${rel.identifier}" ${this.formatVersionReq(rel)}`
          )
        }
      }
    }

    // Also check replaced_by
    for (const [id, meta] of changeset) {
      if (meta.replaced_by) {
        const replacement = allMods.get(meta.replaced_by.identifier)
        if (replacement) {
          result.warnings.push(
            `"${id}" has been replaced by "${meta.replaced_by.identifier}". Consider removing it.`
          )
        }
      }
    }

    // Check installed mods that are replaced by something in the changeset
    for (const [installedId, entry] of Object.entries(installed)) {
      if (changeset.has(installedId)) continue
      if (entry.metadata.replaced_by) {
        const replacementId = entry.metadata.replaced_by.identifier
        if (changeset.has(replacementId) || installed[replacementId]) {
          result.to_remove.push(installedId)
          result.warnings.push(
            `"${installedId}" will be removed — replaced by "${replacementId}"`
          )
        }
      }
    }
  }

  // ── Topological Sort ──

  private topologicalSort(changeset: Map<string, BeamModMetadata>): BeamModMetadata[] {
    const sorted: BeamModMetadata[] = []
    const visited = new Set<string>()
    const visiting = new Set<string>()

    const visit = (id: string): void => {
      if (visited.has(id)) return
      if (visiting.has(id)) return // Cycle — already warned about
      visiting.add(id)

      const meta = changeset.get(id)
      if (meta?.depends) {
        for (const dep of meta.depends) {
          if (this.isAnyOf(dep)) {
            // Visit the first satisfied option
            for (const opt of (dep as RegistryAnyOfRelationship).any_of) {
              if (changeset.has(opt.identifier)) {
                visit(opt.identifier)
                break
              }
            }
          } else {
            const rel = dep as RegistryRelationship
            if (changeset.has(rel.identifier)) {
              visit(rel.identifier)
            }
          }
        }
      }

      visiting.delete(id)
      visited.add(id)
      if (meta) sorted.push(meta)
    }

    for (const id of changeset.keys()) {
      visit(id)
    }

    return sorted
  }

  // ── Version Helpers ──

  private satisfiesRelationship(meta: BeamModMetadata, rel: RegistryRelationship): boolean {
    return this.satisfiesVersionString(meta.version, rel)
  }

  private satisfiesVersionString(version: string, rel: RegistryRelationship): boolean {
    if (rel.version) {
      return this.registry.compareVersions(version, rel.version) === 0
    }
    if (rel.min_version && this.registry.compareVersions(version, rel.min_version) < 0) {
      return false
    }
    if (rel.max_version && this.registry.compareVersions(version, rel.max_version) > 0) {
      return false
    }
    return true
  }

  private formatVersionReq(rel: RegistryRelationship): string {
    if (rel.version) return `= ${rel.version}`
    const parts: string[] = []
    if (rel.min_version) parts.push(`>= ${rel.min_version}`)
    if (rel.max_version) parts.push(`<= ${rel.max_version}`)
    return parts.length ? parts.join(', ') : '(any version)'
  }

  // ── Type Guards ──

  private isAnyOf(rel: RegistryRelationshipDescriptor): rel is RegistryAnyOfRelationship {
    return 'any_of' in rel
  }

  // ── Supports Relationship ──

  /**
   * Find mods in the index that declare `supports` for the given identifier.
   * "supports" is informational (reverse of suggests): e.g. "this wheel pack
   * supports DriftKing vehicle" means it enhances DriftKing when present.
   */
  findSupporters(identifier: string): BeamModMetadata[] {
    const supporters: BeamModMetadata[] = []
    for (const mod of this.registry['remoteIndex'].values()) {
      const latest = mod.versions[0]
      if (!latest?.supports) continue
      for (const rel of latest.supports) {
        if (this.isAnyOf(rel)) continue
        const r = rel as RegistryRelationship
        if (r.identifier === identifier) {
          supporters.push(latest)
          break
        }
      }
    }
    return supporters
  }
}

type SelectionReason = 'user-requested' | 'dependency' | 'recommended' | 'suggested'

interface ResolverOptions {
  /** Include recommends in resolution (default: true) */
  with_recommends?: boolean
  /** Include suggests in resolution (default: false) */
  with_suggests?: boolean
}
