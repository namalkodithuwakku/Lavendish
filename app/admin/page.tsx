import { headers } from "next/headers";
import AdminClient from "./admin-client";
import "./admin.css";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email") ?? "namal.kodithuwakku@gmail.com";
  const encodedName = requestHeaders.get("oai-authenticated-user-full-name");
  const encoding = requestHeaders.get("oai-authenticated-user-full-name-encoding");
  const name = encodedName && encoding === "percent-encoded-utf-8" ? decodeURIComponent(encodedName) : "Namal Kodithuwakku";
  return <AdminClient adminName={name} adminEmail={email} />;
}
