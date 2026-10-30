import { defineConnector } from "@cargo-ai/cdk";

export const raiderHttp = defineConnector("raider_http", {
  integration: "http",
  name: "Raider Nenya sink",
  config: { headers: [] },
});
