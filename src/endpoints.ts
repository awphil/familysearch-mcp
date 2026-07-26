export type FamilySearchEnvironment = "beta" | "production";

export interface FamilySearchEndpoints {
  apiBaseUrl: string;
  authorizationUrl: string;
  tokenUrl: string;
}

const ENDPOINTS: Record<FamilySearchEnvironment, FamilySearchEndpoints> = {
  beta: {
    apiBaseUrl: "https://apibeta.familysearch.org",
    authorizationUrl:
      "https://identbeta.familysearch.org/cis-web/oauth2/v3/authorization",
    tokenUrl: "https://identbeta.familysearch.org/cis-web/oauth2/v3/token",
  },
  production: {
    apiBaseUrl: "https://api.familysearch.org",
    authorizationUrl:
      "https://ident.familysearch.org/cis-web/oauth2/v3/authorization",
    tokenUrl: "https://ident.familysearch.org/cis-web/oauth2/v3/token",
  },
};

export function getEndpoints(
  environment: FamilySearchEnvironment,
): FamilySearchEndpoints {
  return ENDPOINTS[environment];
}
