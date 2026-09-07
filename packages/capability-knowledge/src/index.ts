/** Knowledge remains independent of any note or video provider. */
export interface KnowledgeQuery {
  readonly query: string
  readonly projectId?: string | null
  readonly limit?: number
}

export interface KnowledgeHit {
  readonly documentId: string
  readonly title: string
  readonly text: string
  readonly projectId: string | null
  readonly revision: number
  readonly sourceKind: string
  readonly sourceUrl: string | null
  readonly start: number
  readonly end: number
  readonly score: number
}

export interface KnowledgeService {
  search(query: KnowledgeQuery): Promise<readonly KnowledgeHit[]>
  session(id: string): Promise<KnowledgeSession>
  setSession(id: string, value: KnowledgeSession): Promise<KnowledgeSession>
}

export interface KnowledgeSession {
  readonly enabled: boolean
  /** null means all projects for conversation retrieval. */
  readonly projectId: string | null
}
