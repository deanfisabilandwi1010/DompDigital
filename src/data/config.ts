const subdomain = import.meta.env.VITE_NHOST_SUBDOMAIN as string | undefined;
const region = import.meta.env.VITE_NHOST_REGION as string | undefined;

export const NHOST = {
  configured: !!subdomain && !!region,
  subdomain: subdomain ?? '',
  region: region ?? '',
  authUrl: `https://${subdomain}.auth.${region}.nhost.run/v1`,
  graphqlUrl: `https://${subdomain}.graphql.${region}.nhost.run/v1`,
};
