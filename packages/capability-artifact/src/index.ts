import type { ProjectId } from '@nook-dsh/capability-project'

export type ArtifactId = string

export interface ArtifactDto {
  readonly id: ArtifactId
  readonly projectId: ProjectId
  readonly name: string
  readonly mediaType: string
  readonly byteLength: number
  readonly createdAt: string
}

export interface ArtifactContentDto extends ArtifactDto {
  readonly dataBase64: string
}

export interface WriteArtifactRequest {
  readonly projectId: ProjectId
  readonly name: string
  readonly mediaType: string
  readonly dataBase64: string
}

export interface ArtifactService {
  write(request: WriteArtifactRequest): Promise<ArtifactDto>
  read(artifactId: ArtifactId): Promise<ArtifactContentDto | undefined>
  list(projectId: ProjectId): Promise<readonly ArtifactDto[]>
  delete(artifactId: ArtifactId): Promise<void>
}

export type ArtifactErrorCode = 'INVALID_ARTIFACT' | 'ARTIFACT_NOT_FOUND' | 'ARTIFACT_STORAGE_FAILED'

export class ArtifactError extends Error {
  readonly name = 'ArtifactError'

  constructor(
    readonly code: ArtifactErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}
