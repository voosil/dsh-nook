export interface RefinementService {
  tick(now?: number, force?: boolean): Promise<void>
}
