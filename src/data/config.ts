// Subdomain & region Nhost adalah identitas publik (terlihat di setiap request browser), bukan rahasia.
// Nilai bawaan dipakai bila variabel VITE_NHOST_* tidak diset saat build (mis. di Vercel).
const subdomain = (import.meta.env.VITE_NHOST_SUBDOMAIN as string | undefined) || 'upsuphgefigtqwycbqjf';
const region = (import.meta.env.VITE_NHOST_REGION as string | undefined) || 'ap-southeast-1';

export const NHOST = {
  configured: !!subdomain && !!region,
  subdomain,
  region,
  authUrl: `https://${subdomain}.auth.${region}.nhost.run/v1`,
  graphqlUrl: `https://${subdomain}.graphql.${region}.nhost.run/v1`,
};
