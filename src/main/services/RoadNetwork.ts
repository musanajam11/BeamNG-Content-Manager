/**
 * Road network graph builder + A* pathfinder for GPS-style route plotting.
 *
 * Takes DecalRoad data from BeamNG levels, builds a navigable graph
 * with intersection detection, and provides A* shortest-path queries.
 */

interface GraphEdge {
  to: number
  dist: number
}

interface GraphNode {
  x: number
  y: number
  edges: GraphEdge[]
}

/** Interval (metres) for densifying road segments */
const DENSIFY_INTERVAL = 10
/** Max distance (metres) for snapping two road nodes as an intersection */
const INTERSECTION_RADIUS = 25
/** Larger radius for bridging disconnected graph components */
const BRIDGE_RADIUS = 300
/** Spatial grid cell size for fast proximity lookups */
const CELL_SIZE = 30

export class RoadNetwork {
  nodes: GraphNode[] = []

  /**
   * Build the navigable graph from DecalRoad data.
   * Each road's control-point polyline is densified, then intersections
   * between different roads are detected via spatial hashing.
   */
  build(roads: { nodes: { x: number; y: number; width: number }[]; material: string }[]): void {
    this.nodes = []
    // Reset graph

    // Track which road each graph node belongs to (for intersection detection)
    const roadIdOf: number[] = []

    // Phase 1: Densify each road and add graph nodes + intra-road edges
    for (let ri = 0; ri < roads.length; ri++) {
      const road = roads[ri]
      if (road.nodes.length < 2) continue

      const firstIdx = this.nodes.length

      for (let ni = 0; ni < road.nodes.length - 1; ni++) {
        const a = road.nodes[ni]
        const b = road.nodes[ni + 1]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const segLen = Math.sqrt(dx * dx + dy * dy)
        const steps = Math.max(1, Math.round(segLen / DENSIFY_INTERVAL))

        const startIdx = this.nodes.length

        // Add intermediate points along this segment
        for (let s = 0; s < steps; s++) {
          const t = s / steps
          const idx = this.nodes.length
          this.nodes.push({
            x: a.x + dx * t,
            y: a.y + dy * t,
            edges: []
          })
          roadIdOf.push(ri)

          // Connect to previous node in this road
          if (idx > firstIdx && idx === startIdx && ni > 0) {
            // Connect to last node of previous segment
            const prevIdx = idx - 1
            const d = this.dist(idx, prevIdx)
            this.nodes[idx].edges.push({ to: prevIdx, dist: d })
            this.nodes[prevIdx].edges.push({ to: idx, dist: d })
          } else if (s > 0) {
            const prevIdx = idx - 1
            const d = this.dist(idx, prevIdx)
            this.nodes[idx].edges.push({ to: prevIdx, dist: d })
            this.nodes[prevIdx].edges.push({ to: idx, dist: d })
          }
        }
      }

      // Add the final node of the road
      const last = road.nodes[road.nodes.length - 1]
      const lastIdx = this.nodes.length
      this.nodes.push({ x: last.x, y: last.y, edges: [] })
      roadIdOf.push(ri)

      // Connect to previous
      if (lastIdx > firstIdx) {
        const prevIdx = lastIdx - 1
        const d = this.dist(lastIdx, prevIdx)
        this.nodes[lastIdx].edges.push({ to: prevIdx, dist: d })
        this.nodes[prevIdx].edges.push({ to: lastIdx, dist: d })
      }
    }

    // Phase 2: Spatial hash for intersection detection
    const grid = new Map<string, number[]>()
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i]
      const cx = Math.floor(n.x / CELL_SIZE)
      const cy = Math.floor(n.y / CELL_SIZE)
      const key = `${cx},${cy}`
      const arr = grid.get(key)
      if (arr) arr.push(i)
      else grid.set(key, [i])
    }

    // Phase 3: Connect nodes from different roads that are close together
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i]
      const cx = Math.floor(n.x / CELL_SIZE)
      const cy = Math.floor(n.y / CELL_SIZE)

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const neighbors = grid.get(`${cx + dx},${cy + dy}`)
          if (!neighbors) continue
          for (const j of neighbors) {
            if (j <= i) continue // avoid duplicates
            if (roadIdOf[i] === roadIdOf[j]) continue // same road
            const d = this.dist(i, j)
            if (d <= INTERSECTION_RADIUS) {
              // Check we don't already have this edge
              if (!this.nodes[i].edges.some((e) => e.to === j)) {
                this.nodes[i].edges.push({ to: j, dist: d })
                this.nodes[j].edges.push({ to: i, dist: d })
              }
            }
          }
        }
      }
    }

    // Store grid for snap lookups
    this.grid = grid

    // Phase 4: Bridge disconnected graph components.
    // Some maps (e.g. West Coast USA) have islands connected by bridges that
    // aren't fully represented in DecalRoad data, leaving multi-metre gaps.
    // Find connected components and link closest nodes between them.
    this.bridgeComponents(grid)
  }

  /**
   * Find connected components via BFS and link the closest pair of nodes
   * between any two components that are within BRIDGE_RADIUS of each other.
   * Runs iteratively until no more bridges can be formed.
   */
  private bridgeComponents(grid: Map<string, number[]>): void {
    const n = this.nodes.length
    if (n === 0) return

    for (let iteration = 0; iteration < 10; iteration++) {
      // BFS to label components
      const comp = new Int32Array(n).fill(-1)
      let numComp = 0
      for (let start = 0; start < n; start++) {
        if (comp[start] >= 0) continue
        const cid = numComp++
        const queue = [start]
        comp[start] = cid
        let head = 0
        while (head < queue.length) {
          const cur = queue[head++]
          for (const edge of this.nodes[cur].edges) {
            if (comp[edge.to] < 0) {
              comp[edge.to] = cid
              queue.push(edge.to)
            }
          }
        }
      }

      if (numComp <= 1) {
        if (iteration === 0) return
        console.log(`[RoadNetwork] fully connected after ${iteration} bridge iteration(s)`)
        return
      }
      if (iteration === 0) {
        console.log(`[RoadNetwork] ${numComp} disconnected components, bridging...`)
      }

      // Collect nodes per component
      const compNodes: number[][] = Array.from({ length: numComp }, () => [])
      for (let i = 0; i < n; i++) {
        compNodes[comp[i]].push(i)
      }

      // Find the largest component — bridge everything to it
      let largestComp = 0
      let largestSize = 0
      for (let c = 0; c < numComp; c++) {
        if (compNodes[c].length > largestSize) {
          largestSize = compNodes[c].length
          largestComp = c
        }
      }

      let bridged = 0
      for (let c = 0; c < numComp; c++) {
        if (c === largestComp) continue

        let bestDist = Infinity
        let bestA = -1
        let bestB = -1
        const nodesC = compNodes[c]

        // For each node in this smaller component, search nearby for largest component nodes
        for (let si = 0; si < nodesC.length; si += 3) {
          const ia = nodesC[si]
          const na = this.nodes[ia]
          const cx = Math.floor(na.x / CELL_SIZE)
          const cy = Math.floor(na.y / CELL_SIZE)
          const searchR = Math.ceil(BRIDGE_RADIUS / CELL_SIZE)

          for (let dx = -searchR; dx <= searchR; dx++) {
            for (let dy = -searchR; dy <= searchR; dy++) {
              const neighbors = grid.get(`${cx + dx},${cy + dy}`)
              if (!neighbors) continue
              for (const ib of neighbors) {
                if (comp[ib] === c) continue // same component
                const d = this.dist(ia, ib)
                if (d < bestDist) {
                  bestDist = d
                  bestA = ia
                  bestB = ib
                }
              }
            }
          }
        }

        if (bestA >= 0 && bestDist <= BRIDGE_RADIUS) {
          this.nodes[bestA].edges.push({ to: bestB, dist: bestDist })
          this.nodes[bestB].edges.push({ to: bestA, dist: bestDist })
          bridged++
        }
      }

      console.log(`[RoadNetwork] iteration ${iteration + 1}: bridged ${bridged} of ${numComp - 1} components`)
      if (bridged === 0) {
        // Log remaining disconnected components
        for (let c = 0; c < numComp; c++) {
          if (c === largestComp) continue
          const nodes = compNodes[c]
          if (nodes.length < 3) continue
          let mx = 0, my = 0
          for (const ni of nodes) { mx += this.nodes[ni].x; my += this.nodes[ni].y }
          mx /= nodes.length; my /= nodes.length
          console.log(`  orphan component ${c}: ${nodes.length} nodes around (${mx.toFixed(0)}, ${my.toFixed(0)})`)
        }
        return
      }
    }
  }

  private grid = new Map<string, number[]>()

  /**
   * Find the nearest graph node to a world position using spatial hash.
   */
  snapToNearest(x: number, y: number): number {
    let bestIdx = 0
    let bestDist = Infinity

    const cx = Math.floor(x / CELL_SIZE)
    const cy = Math.floor(y / CELL_SIZE)

    // Search expanding rings until we find a node
    for (let ring = 0; ring <= Math.ceil(Math.max(this.nodes.length > 0 ? 200 : 0) / CELL_SIZE); ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue // only ring perimeter
          const neighbors = this.grid.get(`${cx + dx},${cy + dy}`)
          if (!neighbors) continue
          for (const i of neighbors) {
            const n = this.nodes[i]
            const ddx = n.x - x
            const ddy = n.y - y
            const d = ddx * ddx + ddy * ddy
            if (d < bestDist) {
              bestDist = d
              bestIdx = i
            }
          }
        }
      }
      if (bestDist < Infinity) break // found at least one node in this ring
    }

    return bestIdx
  }

  /**
   * A* shortest path between two world positions.
   * Returns array of {x, y} waypoints along roads, or empty array if no path found.
   */
  findPath(
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): { x: number; y: number }[] {
    if (this.nodes.length === 0) return []

    const startNode = this.snapToNearest(startX, startY)
    const endNode = this.snapToNearest(endX, endY)

    if (startNode === endNode) {
      const n = this.nodes[startNode]
      return [{ x: n.x, y: n.y }]
    }

    // A* with binary-heap priority queue
    const nodeCount = this.nodes.length
    const gScore = new Float64Array(nodeCount).fill(Infinity)
    const fScore = new Float64Array(nodeCount).fill(Infinity)
    const cameFrom = new Int32Array(nodeCount).fill(-1)
    const closed = new Uint8Array(nodeCount)

    gScore[startNode] = 0
    fScore[startNode] = this.heuristic(startNode, endNode)

    // Min-heap using array
    const heap: number[] = [startNode]
    const inOpen = new Uint8Array(nodeCount)
    inOpen[startNode] = 1

    while (heap.length > 0) {
      // Extract min fScore
      let minIdx = 0
      for (let i = 1; i < heap.length; i++) {
        if (fScore[heap[i]] < fScore[heap[minIdx]]) minIdx = i
      }
      const current = heap[minIdx]
      heap[minIdx] = heap[heap.length - 1]
      heap.pop()
      inOpen[current] = 0

      if (current === endNode) {
        return this.reconstructPath(cameFrom, current, startX, startY, endX, endY)
      }

      closed[current] = 1

      for (const edge of this.nodes[current].edges) {
        if (closed[edge.to]) continue

        const tentG = gScore[current] + edge.dist
        if (tentG < gScore[edge.to]) {
          cameFrom[edge.to] = current
          gScore[edge.to] = tentG
          fScore[edge.to] = tentG + this.heuristic(edge.to, endNode)

          if (!inOpen[edge.to]) {
            heap.push(edge.to)
            inOpen[edge.to] = 1
          }
        }
      }
    }

    // No path found — return empty
    return []
  }

  private reconstructPath(
    cameFrom: Int32Array,
    endNode: number,
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): { x: number; y: number }[] {
    const path: { x: number; y: number }[] = []
    let current = endNode
    while (current !== -1) {
      const n = this.nodes[current]
      path.push({ x: n.x, y: n.y })
      current = cameFrom[current]
    }
    path.reverse()

    // Prepend original start point and append original end point
    if (path.length > 0) {
      const first = path[0]
      if (first.x !== startX || first.y !== startY) {
        path.unshift({ x: startX, y: startY })
      }
      const last = path[path.length - 1]
      if (last.x !== endX || last.y !== endY) {
        path.push({ x: endX, y: endY })
      }
    }

    return path
  }

  private heuristic(a: number, b: number): number {
    const na = this.nodes[a]
    const nb = this.nodes[b]
    const dx = na.x - nb.x
    const dy = na.y - nb.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  private dist(a: number, b: number): number {
    const na = this.nodes[a]
    const nb = this.nodes[b]
    const dx = na.x - nb.x
    const dy = na.y - nb.y
    return Math.sqrt(dx * dx + dy * dy)
  }
}
