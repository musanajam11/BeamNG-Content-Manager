import type { RepoMod, RepoBrowseResult, RepoSortOrder, RepoCategory } from '../../shared/types'

const BASE_URL = 'https://www.beamng.com'

export const REPO_CATEGORIES: RepoCategory[] = [
  { id: 0, slug: '', label: 'All' },
  { id: 2, slug: 'vehicles', label: 'Vehicles' },
  { id: 9, slug: 'terrains-levels-maps', label: 'Maps' },
  { id: 8, slug: 'scenarios', label: 'Scenarios' },
  { id: 10, slug: 'user-interface-apps', label: 'UI Apps' },
  { id: 13, slug: 'sounds', label: 'Sounds' },
  { id: 15, slug: 'license-plates', label: 'License Plates' },
  { id: 17, slug: 'track-builder', label: 'Track Builder' },
  { id: 7, slug: 'mods-of-mods', label: 'Mods of Mods' },
  { id: 12, slug: 'skins', label: 'Skins' },
  { id: 16, slug: 'automation', label: 'Automation' }
]

export class BeamNGRepoService {
  private cache = new Map<string, { data: RepoBrowseResult; timestamp: number }>()
  private searchIds = new Map<string, { id: string; timestamp: number }>()
  private cacheTTL = 5 * 60 * 1000 // 5 minutes

  async browse(
    categoryId: number,
    page: number,
    sort: RepoSortOrder
  ): Promise<RepoBrowseResult> {
    const cacheKey = `browse:${categoryId}:${page}:${sort}`
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data
    }

    let url: string
    if (categoryId === 0) {
      url = `${BASE_URL}/resources/?page=${page}&order=${sort}`
    } else {
      const cat = REPO_CATEGORIES.find((c) => c.id === categoryId)
      if (cat && cat.slug) {
        url = `${BASE_URL}/resources/categories/${cat.slug}.${cat.id}/?page=${page}&order=${sort}`
      } else {
        url = `${BASE_URL}/resources/?page=${page}&order=${sort}`
      }
    }

    const html = await this.fetchPage(url)
    const result = this.parseResourceList(html)

    this.cache.set(cacheKey, { data: result, timestamp: Date.now() })
    return result
  }

  async search(query: string, page: number): Promise<RepoBrowseResult> {
    const cacheKey = `search:${query}:${page}`
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data
    }

    let html: string

    if (page === 1) {
      html = await this.performSearchPost(query)
    } else {
      // For page > 1, we need the search ID from a previous page-1 search
      let searchIdEntry = this.searchIds.get(query)
      if (!searchIdEntry || Date.now() - searchIdEntry.timestamp > this.cacheTTL) {
        await this.performSearchPost(query)
        searchIdEntry = this.searchIds.get(query)
      }
      if (!searchIdEntry) throw new Error('Search failed')
      const url = `${BASE_URL}/search/${searchIdEntry.id}/?page=${page}&q=${encodeURIComponent(query)}&t=resource_update&o=date`
      html = await this.fetchPage(url)
    }

    const result = this.parseSearchResults(html)

    this.cache.set(cacheKey, { data: result, timestamp: Date.now() })
    return result
  }

  private async performSearchPost(query: string): Promise<string> {
    const response = await fetch(`${BASE_URL}/search/search`, {
      method: 'POST',
      headers: {
        'User-Agent': 'BeamMP-ContentManager/1.0',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `keywords=${encodeURIComponent(query)}&type=resource_update`,
      redirect: 'follow'
    })
    if (!response.ok) {
      throw new Error(`Search failed: HTTP ${response.status}`)
    }

    // Extract search ID from final URL after redirect
    const finalUrl = response.url
    const idMatch = finalUrl.match(/\/search\/(\d+)\//)
    if (idMatch) {
      this.searchIds.set(query, { id: idMatch[1], timestamp: Date.now() })
    }

    return response.text()
  }

  getCategories(): RepoCategory[] {
    return REPO_CATEGORIES
  }

  private async fetchPage(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'BeamMP-ContentManager/1.0' }
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return response.text()
  }

  private parseResourceList(html: string): RepoBrowseResult {
    const mods = this.extractResourceItems(html)

    // Pagination: <div class="PageNav" data-page="1" data-last="85">
    let currentPage = 1
    let totalPages = 1
    const pageNavMatch = html.match(
      /class="PageNav"[^>]*data-page="(\d+)"[^>]*data-last="(\d+)"/
    )
    if (pageNavMatch) {
      currentPage = parseInt(pageNavMatch[1], 10)
      totalPages = parseInt(pageNavMatch[2], 10)
    }

    return { mods, currentPage, totalPages }
  }

  private parseSearchResults(html: string): RepoBrowseResult {
    const mods: RepoMod[] = []

    // Search results: <li id="resource_update-ID" class="searchResult resourceUpdate primaryContent" data-author="AUTHOR">
    const blockRegex =
      /<li\s+id="resource_update-(\d+)"\s+class="searchResult[^"]*"[^>]*data-author="([^"]*)"[^>]*>([\s\S]*?)(?=<li\s+id="resource_update-|<\/ol>)/g
    let match: RegExpExecArray | null

    while ((match = blockRegex.exec(html)) !== null) {
      const author = match[2].trim()
      const block = match[3]

      let resourceId = 0
      let title = ''
      let slug = ''
      let prefix: string | null = null
      let version = ''

      const titleMatch = block.match(/<h3\s+class="title">([\s\S]*?)<\/h3>/)
      if (titleMatch) {
        const titleBlock = titleMatch[1]

        // Prefix: <span class="prefix prefixXxx">PREFIX</span>
        const prefixMatch = titleBlock.match(/class="prefix[^"]*">([^<]+)<\/span>/)
        if (prefixMatch) prefix = prefixMatch[1].trim()

        // Title link: <a href="resources/SLUG.ID/">TITLE</a> (may have ?update=X suffix)
        const linkMatch = titleBlock.match(
          /href="resources\/([^"]+)\.(\d+)\/[^"]*"[^>]*>([\s\S]*?)<\/a>/
        )
        if (linkMatch) {
          slug = decodeURIComponent(linkMatch[1])
          resourceId = parseInt(linkMatch[2], 10)
          // Strip any HTML tags from the title text (e.g. prefix span inside link)
          title = linkMatch[3].replace(/<[^>]+>/g, '').trim()
          // Remove prefix from title text to avoid duplication
          if (prefix) {
            title = title.replace(new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*'), '').trim()
          }
        }

        // Version: <span class="muted">VERSION</span>
        const versionMatch = titleBlock.match(/<span\s+class="muted">([^<]+)<\/span>/)
        if (versionMatch) version = versionMatch[1].trim()
      }

      if (!title) continue

      // Category: <a href="resources/categories/CAT_SLUG.ID/">CATEGORY</a>
      let category = ''
      let categoryId = 0
      const catMatch = block.match(
        /href="resources\/categories\/[^.]+\.(\d+)\/">([^<]+)<\/a>/
      )
      if (catMatch) {
        categoryId = parseInt(catMatch[1], 10)
        category = catMatch[2].trim()
      }

      // TagLine from snippet: <blockquote class="snippet">..TEXT..</blockquote>
      let tagLine = ''
      const snippetMatch = block.match(
        /<blockquote\s+class="snippet">([\s\S]*?)<\/blockquote>/
      )
      if (snippetMatch) {
        tagLine = snippetMatch[1].replace(/<[^>]+>/g, '').trim()
      }

      // Construct thumbnail URL from resource ID: data/resource_icons/{floor(id/1000)}/{id}.jpg
      const iconFolder = Math.floor(resourceId / 1000)
      const thumbnailUrl = `${BASE_URL}/data/resource_icons/${iconFolder}/${resourceId}.jpg`
      const pageUrl = `${BASE_URL}/resources/${slug}.${resourceId}/`

      mods.push({
        resourceId,
        slug,
        title: this.decodeEntities(title),
        version,
        author,
        category,
        categoryId,
        tagLine: this.decodeEntities(tagLine),
        thumbnailUrl,
        rating: 0,
        ratingCount: 0,
        downloads: 0,
        subscriptions: 0,
        prefix,
        pageUrl
      })
    }

    let currentPage = 1
    let totalPages = 1
    const pageNavMatch = html.match(
      /class="PageNav"[^>]*data-page="(\d+)"[^>]*data-last="(\d+)"/
    )
    if (pageNavMatch) {
      currentPage = parseInt(pageNavMatch[1], 10)
      totalPages = parseInt(pageNavMatch[2], 10)
    }

    return { mods, currentPage, totalPages }
  }

  private decodeEntities(text: string): string {
    return text
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
  }

  private extractResourceItems(html: string): RepoMod[] {
    const mods: RepoMod[] = []

    // Split into individual resource item blocks
    // Each starts with <li class="resourceListItem and ends at the next <li or </ol>
    const itemRegex = /<li\s+class="resourceListItem[^"]*"\s+id="resource-(\d+)">([\s\S]*?)(?=<li\s+class="resourceListItem|<\/ol>)/g
    let match: RegExpExecArray | null

    while ((match = itemRegex.exec(html)) !== null) {
      const resourceId = parseInt(match[1], 10)
      const block = match[2]

      const mod = this.parseResourceBlock(resourceId, block)
      if (mod) mods.push(mod)
    }

    return mods
  }

  private parseResourceBlock(resourceId: number, block: string): RepoMod | null {
    // Thumbnail: <img src="data/resource_icons/XX/XXXXX.jpg?..." />
    let thumbnailUrl = ''
    const thumbMatch = block.match(
      /class="resourceIcon"[^>]*><img\s+src="([^"]+)"/
    )
    if (thumbMatch) {
      thumbnailUrl = thumbMatch[1].startsWith('http')
        ? thumbMatch[1]
        : `${BASE_URL}/${thumbMatch[1].replace(/^\//, '')}`
    }

    // Title + slug: <a href="resources/SLUG.ID/">TITLE</a>
    let title = ''
    let slug = ''
    const titleMatch = block.match(
      /<h3\s+class="title">([\s\S]*?)<\/h3>/
    )
    if (titleMatch) {
      const titleBlock = titleMatch[1]
      const linkMatch = titleBlock.match(
        /href="resources\/([^"]+)\.(\d+)\/"[^>]*>([^<]+)<\/a>/
      )
      if (linkMatch) {
        slug = linkMatch[1]
        title = linkMatch[3].trim()
      }
    }

    if (!title) return null

    // Version: <span class="version">VERSION</span>
    let version = ''
    const versionMatch = block.match(/<span\s+class="version">([^<]+)<\/span>/)
    if (versionMatch) version = versionMatch[1].trim()

    // Prefix (Beta, Alpha, Experimental): appears before the title link in h3
    let prefix: string | null = null
    if (titleMatch) {
      const prefixMatch = titleMatch[1].match(
        /class="prefix[^"]*">([^<]+)<\/span>/
      )
      if (prefixMatch) {
        prefix = prefixMatch[1].trim()
      } else {
        // Some prefixes appear as plain text before the link
        const textBefore = titleMatch[1].replace(/<[^>]+>/g, '').split(title)[0]?.trim()
        if (textBefore && /^(Alpha|Beta|Experimental)$/i.test(textBefore)) {
          prefix = textBefore
        }
      }
    }

    // Author: <a href="resources/authors/AUTHOR_SLUG.ID/">AUTHOR</a>
    let author = ''
    const authorMatch = block.match(
      /href="resources\/authors\/[^"]+">([^<]+)<\/a>/
    )
    if (authorMatch) author = authorMatch[1].trim()

    // Category: <a href="resources/categories/CAT_SLUG.ID/">CATEGORY</a>
    let category = ''
    let categoryId = 0
    const catMatch = block.match(
      /href="resources\/categories\/([^.]+)\.(\d+)\/">([^<]+)<\/a>/
    )
    if (catMatch) {
      categoryId = parseInt(catMatch[2], 10)
      category = catMatch[3].trim()
    }

    // TagLine: <div class="tagLine">TEXT</div>
    let tagLine = ''
    const tagMatch = block.match(/<div\s+class="tagLine">([\s\S]*?)<\/div>/)
    if (tagMatch) tagLine = tagMatch[1].replace(/<[^>]+>/g, '').trim()

    // Rating: <span class="ratings" title="5.00">
    let rating = 0
    const ratingMatch = block.match(/class="ratings"\s+title="([\d.]+)"/)
    if (ratingMatch) rating = parseFloat(ratingMatch[1])

    // Rating count: <span class="Hint">N rating(s)</span>
    let ratingCount = 0
    const ratingCountMatch = block.match(/<span\s+class="Hint">(\d+)\s+rating/)
    if (ratingCountMatch) ratingCount = parseInt(ratingCountMatch[1], 10)

    // Downloads: <dt>Downloads:</dt> <dd>N</dd>
    let downloads = 0
    const dlMatch = block.match(/<dt>Downloads:<\/dt>\s*<dd>([\d,]+)<\/dd>/)
    if (dlMatch) downloads = parseInt(dlMatch[1].replace(/,/g, ''), 10)

    // Subscriptions: <dt>Subscriptions:</dt> <dd>N</dd>
    let subscriptions = 0
    const subMatch = block.match(/<dt>Subscriptions:<\/dt>\s*<dd>([\d,]+)<\/dd>/)
    if (subMatch) subscriptions = parseInt(subMatch[1].replace(/,/g, ''), 10)

    const pageUrl = `${BASE_URL}/resources/${slug}.${resourceId}/`

    return {
      resourceId,
      slug,
      title,
      version,
      author,
      category,
      categoryId,
      tagLine,
      thumbnailUrl,
      rating,
      ratingCount,
      downloads,
      subscriptions,
      prefix,
      pageUrl
    }
  }
}
