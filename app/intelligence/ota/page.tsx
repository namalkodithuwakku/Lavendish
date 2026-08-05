import {IntelligenceShell} from "../intelligence-shell";
import AlertsClient from "../../alerts/alerts-client";
import "../../alerts/alerts.css";
import "../alerts-integration.css";
import "../professional-alerts.css";
import "../operations-workspace.css";
import "../operations-typography.css";

export default function OtaPage(){return <IntelligenceShell eyebrow="CHANNEL MANAGEMENT" title="OTA"><div className="integrated-alerts"><AlertsClient mode="ota"/></div></IntelligenceShell>}
