import { headers } from "next/headers";
import UsersClient from "./users-client";
import "../admin.css";
import "./users.css";

export const dynamic="force-dynamic";
export default async function UsersPage(){
 const h=await headers();
 const email=h.get("oai-authenticated-user-email")??"namal.kodithuwakku@gmail.com";
 const encoded=h.get("oai-authenticated-user-full-name");
 const name=encoded&&h.get("oai-authenticated-user-full-name-encoding")==="percent-encoded-utf-8"?decodeURIComponent(encoded):"Namal Kodithuwakku";
 return <UsersClient adminName={name} adminEmail={email}/>;
}
