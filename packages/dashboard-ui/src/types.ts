// Additional types for dashboard components
export interface ProviderOption {
  name: string;
  label?: string;
  type: string;
  available: boolean;
  configured?: boolean;
  defaultModel?: string;
  description?: string;
}

