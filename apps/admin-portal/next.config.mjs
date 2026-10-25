/** @type {import("next").NextConfig} */
const nextConfig = {
  agentRules: false,
  // MS-84 / PRD-F13: retain the known closure-alert bookmark only.
  async redirects() {
    return [{
      source: "/admin/reservations",
      has: [{ type: "query", key: "filter", value: "closure_impacted" }],
      destination: "/manage/reservations?filter=closure_impacted",
      permanent: false,
    }];
  },
  transpilePackages: ["@deskatlas/domain", "@deskatlas/ui"],
};

export default nextConfig;
