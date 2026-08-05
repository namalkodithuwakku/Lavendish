import { IntelligenceShell } from "../../intelligence/intelligence-shell";
import { SettingsUsersClient } from "./settings-users-client";
import "../../admin/admin.css";
import "../../admin/users/users.css";
import "./settings-users.css";

export default function SettingsUsersPage(){return <IntelligenceShell eyebrow="SETTINGS · ACCESS CONTROL" title="Users & Access"><SettingsUsersClient/></IntelligenceShell>}
