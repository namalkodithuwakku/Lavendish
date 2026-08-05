import { IntelligenceShell } from "../intelligence-shell";
import { YieldWorkspace } from "./yield-workspace";
import "../../admin/admin.css";
import "../../admin/yield/yield.css";
import "../../admin/yield/rate-plan-manager.css";
import "../../alerts/alerts.css";
import "../alerts-integration.css";
import "./yield-workspace.css";

export default function YieldPage(){return <IntelligenceShell eyebrow="RATE MANAGEMENT" title="Yield"><YieldWorkspace/></IntelligenceShell>}
