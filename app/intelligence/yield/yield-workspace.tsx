"use client";
import {useState} from "react";
import YieldClient from "../../admin/yield/yield-client";
import AlertsClient from "../../alerts/alerts-client";

export function YieldWorkspace(){const [view,setView]=useState<"formula"|"recommendations">("recommendations");return <div className="yield-workspace"><nav className="yield-workspace-tabs" aria-label="Yield sections"><button className={view==="recommendations"?"active":""} onClick={()=>setView("recommendations")}><b>Recommendations</b><span>Live rate suggestions</span></button><button className={view==="formula"?"active":""} onClick={()=>setView("formula")}><b>Rate formula</b><span>Plans, bands and thresholds</span></button></nav>{view==="formula"?<div className="integrated-yield"><YieldClient/></div>:<div className="integrated-alerts"><AlertsClient mode="yield"/></div>}</div>}
