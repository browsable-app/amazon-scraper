export interface PublicApiScraperInput extends Record<string, unknown> {}
export interface PublicApiPagination {
  cursor: string | null;
  next_cursor: string | null;
  has_next_page: boolean;
  count: number;
  strategy: string | null;
}
export interface PublicApiScraperOutput {
  success: true;
  source: string;
  query: string | null;
  url: string | null;
  results: Record<string, unknown>[];
  count: number;
  data: Record<string, unknown> | null;
  max_results_requested: number;
  pagination: PublicApiPagination;
}
