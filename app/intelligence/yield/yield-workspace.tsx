"use client";
import {useState} from "react";
import YieldClient from "../../admin/yield/yield-client";
import {ModuleClient} from "../module-client";

export function YieldWorkspace(){const [view,setView]=useState<"formula"|"recommendations">("formula");return <div className="yield-workspace"><nav className="yield-workspace-tabs" aria-label="Yield sections"><button className={view==="formula"?"active":""} onClick={()=>setView("formula")}><b>Rate formula</b><span>Plans, occupancy bands and thresholds</span></button><button className={view==="recommendations"?"active":""} onClick={()=>setView("recommendations")}><b>Recommendations</b><span>Yield actions awaiting review</span></button></nav>{view==="formula"?<div className="integrated-yield"><YieldClient/></div>:<ModuleClient category="YIELD"/>}</div>}
