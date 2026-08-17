import {IntelligenceShell} from "../intelligence/intelligence-shell";
import {TasksClient} from "./tasks-client";
import "./tasks.css";
export default function TasksPage(){return <IntelligenceShell eyebrow="STAFF OPERATIONS" title="Tasks"><TasksClient/></IntelligenceShell>}