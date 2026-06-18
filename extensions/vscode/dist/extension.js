"use strict";var Se=Object.create;var W=Object.defineProperty;var Pe=Object.getOwnPropertyDescriptor;var Ce=Object.getOwnPropertyNames;var ke=Object.getPrototypeOf,Ie=Object.prototype.hasOwnProperty;var De=(o,e)=>{for(var t in e)W(o,t,{get:e[t],enumerable:!0})},ae=(o,e,t,s)=>{if(e&&typeof e=="object"||typeof e=="function")for(let c of Ce(e))!Ie.call(o,c)&&c!==t&&W(o,c,{get:()=>e[c],enumerable:!(s=Pe(e,c))||s.enumerable});return o};var w=(o,e,t)=>(t=o!=null?Se(ke(o)):{},ae(e||!o||!o.__esModule?W(t,"default",{value:o,enumerable:!0}):t,o)),Ee=o=>ae(W({},"__esModule",{value:!0}),o);var ze={};De(ze,{activate:()=>Ve,deactivate:()=>Ke});module.exports=Ee(ze);var m=w(require("vscode")),ie=require("node:path");var g=w(require("vscode")),de=require("node:path"),le="Prometheus";function $e(o){switch(o){case"BLOCKER":case"HIGH":return g.DiagnosticSeverity.Error;case"MEDIUM":return g.DiagnosticSeverity.Warning;case"LOW":return g.DiagnosticSeverity.Information;case"TECH_DEBT":return g.DiagnosticSeverity.Hint}}function ce(o){let e=Math.max(0,(o.line??1)-1),t=new g.Range(e,0,e,Number.MAX_SAFE_INTEGER),s=new g.Diagnostic(t,o.suggestion?`${o.message}

Suggestion: ${o.suggestion}`:o.message,$e(o.severity));return s.source=le,s.code=o.category,s}var j=class{collection;constructor(){this.collection=g.languages.createDiagnosticCollection(le)}setAll(e,t){let s=new Map;for(let c of e){let r=(0,de.join)(t,c.file),d=g.Uri.file(r).toString(),i=s.get(d)??[];i.push(ce(c)),s.set(d,i)}this.collection.clear();for(let[c,r]of s)this.collection.set(g.Uri.parse(c),r)}setForFile(e,t){this.collection.set(e,t.map(ce))}clearForFile(e){this.collection.delete(e)}clear(){this.collection.clear()}dispose(){this.collection.dispose()}};var f=w(require("vscode")),_=class{item;constructor(){this.item=f.window.createStatusBarItem(f.StatusBarAlignment.Left,100),this.item.command="prometheus.health",this.item.tooltip="Prometheus Governance \u2014 click to view health score",this.showInactive(),this.item.show()}showLoading(){this.item.text="$(sync~spin) Prometheus",this.item.tooltip="Prometheus Governance \u2014 analysing\u2026",this.item.backgroundColor=void 0}showHealth(e,t){let{score:s,grade:c}=e;c==="A+"||c==="A"?(this.item.text=`$(shield) ${c}  ${s}`,this.item.backgroundColor=void 0):c==="B"||c==="C"?(this.item.text=`$(warning) ${c}  ${s}`,this.item.backgroundColor=new f.ThemeColor("statusBarItem.warningBackground")):(this.item.text=`$(error) ${c}  ${s}`,this.item.backgroundColor=new f.ThemeColor("statusBarItem.errorBackground"));let r=t===0?"No findings":`${t} finding${t===1?"":"s"}`;this.item.tooltip=new f.MarkdownString(`**Prometheus Governance** \u2014 Health Score

Grade: **${c}**   Score: **${s}/100**

${r}

_Click to open health dashboard_`)}showScanNeeded(){this.item.text="$(warning) Prometheus: scan needed",this.item.tooltip='Prometheus Governance \u2014 run "Prometheus: Scan Repository" to start',this.item.backgroundColor=new f.ThemeColor("statusBarItem.warningBackground")}showNotInstalled(){this.item.text="$(error) Prometheus: not installed",this.item.tooltip="prometheus-governance not found \u2014 run: npm install --save-dev prometheus-governance",this.item.backgroundColor=new f.ThemeColor("statusBarItem.errorBackground")}showAutopilotSession(e,t){t?(this.item.text="$(stop-circle) Autopilot: cancelling\u2026",this.item.backgroundColor=new f.ThemeColor("statusBarItem.warningBackground")):(this.item.text=`$(sync~spin) Autopilot: ${e}`,this.item.backgroundColor=new f.ThemeColor("statusBarItem.prominentBackground")),this.item.command="prometheus.autopilot.cancel",this.item.tooltip=t?"Autopilot cancelling \u2014 click to view session":"Autopilot running \u2014 click to cancel"}clearAutopilotSession(){this.item.command="prometheus.health",this.item.tooltip="Prometheus Governance \u2014 click to view health score",this.item.backgroundColor=void 0}showInactive(){this.item.text="$(shield) Prometheus",this.item.tooltip="Prometheus Governance",this.item.backgroundColor=void 0}hide(){this.item.hide()}show(){this.item.show()}dispose(){this.item.dispose()}};var h=w(require("vscode")),U=require("node:path"),ue=["BLOCKER","HIGH","MEDIUM","LOW","TECH_DEBT"],Ae={BLOCKER:"Blocker",HIGH:"High",MEDIUM:"Medium",LOW:"Low",TECH_DEBT:"Tech Debt"},he={BLOCKER:"error",HIGH:"error",MEDIUM:"warning",LOW:"info",TECH_DEBT:"lightbulb"},pe={BLOCKER:new h.ThemeColor("errorForeground"),HIGH:new h.ThemeColor("errorForeground"),MEDIUM:new h.ThemeColor("editorWarning.foreground"),LOW:new h.ThemeColor("editorInfo.foreground"),TECH_DEBT:new h.ThemeColor("editorHint.foreground")},L=class extends h.TreeItem{constructor(t,s,c){let r=s.length,d=`${Ae[t]}  (${r})`,i=r===0?h.TreeItemCollapsibleState.None:t==="BLOCKER"||t==="HIGH"||!c?h.TreeItemCollapsibleState.Expanded:h.TreeItemCollapsibleState.Collapsed;super(d,i);this.severity=t;this.findings=s;this.iconPath=new h.ThemeIcon(he[t],pe[t]),this.contextValue="severityGroup",this.description=r===0?"none":void 0}kind="group"},Z=class extends h.TreeItem{constructor(t,s){super(t.message,h.TreeItemCollapsibleState.None);this.finding=t;this.description=(0,U.basename)(t.file),this.tooltip=new h.MarkdownString(`**${t.severity}** \xB7 \`${t.category}\`

${t.message}`+(t.suggestion?`

_${t.suggestion}_`:"")),this.iconPath=new h.ThemeIcon(he[t.severity],pe[t.severity]),this.contextValue="finding";let c=(0,U.join)(s,t.file),r=Math.max(0,(t.line??1)-1);this.command={command:"vscode.open",title:"Open File",arguments:[h.Uri.file(c),{selection:new h.Range(r,0,r,0),preview:!0}]}}kind="finding"},k=class extends h.TreeItem{kind="empty";constructor(e){super(e,h.TreeItemCollapsibleState.None),this.iconPath=new h.ThemeIcon("pass-filled"),this.contextValue="empty"}},G=class{_onDidChangeTreeData=new h.EventEmitter;onDidChangeTreeData=this._onDidChangeTreeData.event;findings=[];workspaceRoot="";state="idle";refresh(e,t){this.findings=e,this.workspaceRoot=t,this.state="ready",this._onDidChangeTreeData.fire()}setLoading(){this.state="loading",this._onDidChangeTreeData.fire()}setNoReport(){this.state="no-report",this._onDidChangeTreeData.fire()}setNotInstalled(){this.state="not-installed",this._onDidChangeTreeData.fire()}getTreeItem(e){return e}getChildren(e){if(e instanceof L)return e.findings.map(c=>new Z(c,this.workspaceRoot));if(this.state==="loading")return[new k("Analysing\u2026")];if(this.state==="no-report")return[new k('Run "Prometheus: Scan Repository" to start')];if(this.state==="not-installed")return[new k("prometheus-governance not installed")];if(this.state==="idle")return[];if(this.findings.length===0)return[new k("All governance checks passed")];let t=this.findings.some(c=>c.severity==="BLOCKER"),s=new Map;for(let c of ue)s.set(c,[]);for(let c of this.findings)s.get(c.severity)?.push(c);return ue.filter(c=>(s.get(c)?.length??0)>0).map(c=>new L(c,s.get(c)??[],t))}dispose(){this._onDidChangeTreeData.dispose()}};var y=w(require("vscode")),A=require("node:fs"),ee=require("node:path"),V=class{constructor(e){this.workspaceRoot=e;this.sessionPath=(0,ee.join)(e,".prometheus","autopilot",".session.json"),this.cancelPath=(0,ee.join)(e,".prometheus","autopilot",".cancel");let t=new y.RelativePattern(y.Uri.file(e),".prometheus/autopilot/**"),s=y.workspace.createFileSystemWatcher(t);s.onDidChange(()=>this.reload()),s.onDidCreate(()=>this.reload()),s.onDidDelete(()=>this.reload()),this.disposables.push(s,this._onDidChange),this.reload()}disposables=[];_onDidChange=new y.EventEmitter;onDidChange=this._onDidChange.event;currentSession=null;sessionPath;cancelPath;reload(){let e=this.readSession();JSON.stringify(e)!==JSON.stringify(this.currentSession)&&(this.currentSession=e,this._onDidChange.fire(e))}readSession(){if(!(0,A.existsSync)(this.sessionPath))return null;try{return JSON.parse((0,A.readFileSync)(this.sessionPath,"utf8"))}catch{return null}}get session(){return this.currentSession}get isCancelling(){return(0,A.existsSync)(this.cancelPath)}buildTaskDisplayStates(e){let t=this.currentSession,s=Be(e);if(!t||s.length===0)return[];let c=s.filter(r=>!r.isCheckpoint).find(r=>{let d=t.completedTaskIndexes.includes(r.index),i=t.blockedTasks.some(l=>l.index===r.index),a=t.timedOutTaskIndexes.includes(r.index);return!d&&!i&&!a})?.index??-1;return s.map(r=>{if(r.isCheckpoint)return{index:r.index,title:"CHECKPOINT",status:"checkpoint",isCheckpoint:!0};if(t.completedTaskIndexes.includes(r.index))return{index:r.index,title:r.title,status:"complete",isCheckpoint:!1};let d=t.blockedTasks.find(i=>i.index===r.index);return d?{index:r.index,title:r.title,status:"blocked",blockReason:d.reason,isCheckpoint:!1}:t.timedOutTaskIndexes.includes(r.index)?{index:r.index,title:r.title,status:"timedout",isCheckpoint:!1}:r.index===c?{index:r.index,title:r.title,status:"running",isCheckpoint:!1}:{index:r.index,title:r.title,status:"pending",isCheckpoint:!1}})}dispose(){for(let e of this.disposables)e.dispose()}};function Be(o){let e=[],t=0;for(let s of o.split(`
`))s.trim()==="---CHECKPOINT---"?e.push({index:t++,title:"CHECKPOINT",isCheckpoint:!0}):s.startsWith("## ")&&e.push({index:t++,title:s.slice(3).trim(),isCheckpoint:!1});return e}var u=w(require("vscode")),z=require("node:fs"),ve=require("node:path"),I=class extends u.TreeItem{constructor(t,s,c,r=u.TreeItemCollapsibleState.None){super(t,r);this.itemType=s;this.taskState=c;this.contextValue=s==="task"?`autopilotTask.${c?.status??"pending"}`:s}},me={complete:new u.ThemeIcon("check",new u.ThemeColor("testing.iconPassed")),blocked:new u.ThemeIcon("error",new u.ThemeColor("testing.iconFailed")),timedout:new u.ThemeIcon("clock",new u.ThemeColor("disabledForeground")),running:new u.ThemeIcon("sync~spin",new u.ThemeColor("progressBar.background")),pending:new u.ThemeIcon("circle-outline",new u.ThemeColor("disabledForeground")),checkpoint:new u.ThemeIcon("milestone",new u.ThemeColor("charts.blue"))},Re={complete:"complete",blocked:"blocked",timedout:"timed out",running:"running\u2026",pending:"pending",checkpoint:""},K=class{constructor(e,t){this.workspaceRoot=e;let s=t.onDidChange(()=>{this.rebuild(t),this._onDidChangeTreeData.fire()});this.disposables.push(s),this.rebuild(t)}_onDidChangeTreeData=new u.EventEmitter;onDidChangeTreeData=this._onDidChangeTreeData.event;disposables=[this._onDidChangeTreeData];items=[];rebuild(e){let t=e.session;if(!t){this.items=[Object.assign(new I("No active autopilot session","empty"),{description:"Run: prometheus autopilot start MASTER_PLAN.md"}),Object.assign(new I("Generate a plan\u2026","action"),{iconPath:new u.ThemeIcon("wand"),command:{command:"prometheus.autopilot.generate",title:"Generate Plan"}})],u.commands.executeCommand("setContext","prometheus.autopilotActive",!1);return}u.commands.executeCommand("setContext","prometheus.autopilotActive",!0);let s=t.completedTaskIndexes.length+t.blockedTasks.length+t.timedOutTaskIndexes.length,c=t.completedTaskIndexes.length,r=e.isCancelling,d=new I(`${t.planSlug}`,"header",void 0,u.TreeItemCollapsibleState.None);d.description=r?"cancelling\u2026":`${c} / ${s+(t.blockedTasks.length>0,0)} done`,d.iconPath=r?new u.ThemeIcon("warning",new u.ThemeColor("statusBarItem.warningBackground")):new u.ThemeIcon("rocket"),d.tooltip=new u.MarkdownString(`**Branch:** \`${t.branch}\`  
**Session:** ${t.id}  
**Adapter:** ${t.adapter}  
**Started:** ${t.startedAt}`),d.contextValue="autopilotHeader";let i="",a=(0,ve.join)(this.workspaceRoot,t.planPath);if((0,z.existsSync)(a))try{i=(0,z.readFileSync)(a,"utf8")}catch{}let p=e.buildTaskDisplayStates(i).map(v=>{let O=new I(v.isCheckpoint?"\u2500\u2500\u2500 CHECKPOINT \u2500\u2500\u2500":`Task ${v.index+1}: ${v.title}`,"task",v);return O.iconPath=me[v.status]??me.pending,O.description=Re[v.status]??"",v.blockReason&&(O.tooltip=`Blocked: ${v.blockReason}`),O});this.items=[d,...p]}getTreeItem(e){return e}getChildren(e){return e?[]:this.items}dispose(){for(let e of this.disposables)e.dispose()}};var n=w(require("vscode")),ne=require("node:path"),M=require("node:fs");var ge=require("node:child_process"),J=require("node:fs"),te=require("node:path"),fe=require("node:util"),Fe=(0,fe.promisify)(ge.execFile),Me=45e3,He=10*1024*1024,T=class extends Error{constructor(e){super(`prometheus-governance not found in ${e}/node_modules/.bin/prometheus.
Run: npm install --save-dev prometheus-governance`),this.name="PrometheusNotFoundError"}},b=class extends Error{constructor(){super('.prometheus/report.json not found \u2014 run "Prometheus: Scan Repository" first.'),this.name="PrometheusReportMissingError"}},Y=class extends Error{constructor(e,t){super(`Failed to parse JSON from 'prometheus ${e}':
${t.slice(0,300)}`),this.name="PrometheusParseError"}};function D(o,e){if(e&&e.trim()){if((0,J.existsSync)(e.trim()))return e.trim();throw new T(o)}let t=(0,te.join)(o,"node_modules",".bin","prometheus");if((0,J.existsSync)(t))return t;throw new T(o)}function we(o,e){try{return D(o,e),!0}catch{return!1}}function oe(o){return(0,J.existsSync)((0,te.join)(o,".prometheus","report.json"))}async function B(o,e,t){let{stdout:s}=await Fe(o,e,{cwd:t,timeout:Me,maxBuffer:He,env:{...process.env,FORCE_COLOR:"0"}});return s}async function se(o,e,t=[]){let s=D(o,e),c=["review","--json",...t],r;try{r=await B(s,c,o)}catch(d){throw d.stderr?.includes("report.json not found")?new b:d}try{return JSON.parse(r)}catch{throw new Y("review",r)}}async function q(o,e){let t=D(o,e),s;try{s=await B(t,["health","--json"],o)}catch(c){throw c.stderr?.includes("report.json not found")?new b:c}try{return JSON.parse(s)}catch{throw new Y("health",s)}}async function be(o,e){let t=D(o,e);await B(t,["scan"],o)}async function xe(o,e){let t=D(o,e);await B(t,["adapters"],o)}async function R(o,e,t){let s=D(o,t);return B(s,e,o)}var F=w(require("vscode")),X=class o{static instance;panel;lastHealth=null;constructor(e){this.panel=F.window.createWebviewPanel("prometheus.health","Prometheus Health",F.ViewColumn.Beside,{enableScripts:!0,retainContextWhenHidden:!0,localResourceRoots:[e]}),this.panel.onDidDispose(()=>{o.instance=void 0})}static show(e,t){o.instance||(o.instance=new o(e));let s=o.instance;return s.lastHealth=t,s.panel.webview.html=Le(t),s.panel.reveal(F.ViewColumn.Beside,!0),s}dispose(){this.panel.dispose(),o.instance=void 0}};function Ne(o){return o==="A+"||o==="A"?"var(--vscode-charts-green, #73c991)":o==="B"?"var(--vscode-charts-blue, #4daafc)":o==="C"?"var(--vscode-charts-yellow, #cca700)":"var(--vscode-charts-red, #f48771)"}function Oe(o){let e=Math.max(0,Math.min(100,o)),t=o>=80?"var(--vscode-charts-green, #73c991)":o>=60?"var(--vscode-charts-yellow, #cca700)":"var(--vscode-charts-red, #f48771)";return`
    <div class="score-bar-track">
      <div class="score-bar-fill" style="width:${e}%;background:${t}"></div>
    </div>`}function We(o){return o.deductions.length===0?'<p class="muted">No deductions \u2014 excellent governance posture.</p>':o.deductions.map(e=>`<div class="deduction-row">
          <span class="deduction-label">${S(e.label)}</span>
          <span class="deduction-amount">\u2212${e.amount}</span>
          ${e.detail?`<p class="deduction-detail">${S(e.detail)}</p>`:""}
        </div>`).join(`
`)}function je(o){return o.bonuses.length===0?"":`
    <section class="card">
      <h2>Bonuses</h2>
      ${o.bonuses.map(e=>`<div class="bonus-row"><span>${S(e.label)}</span><span class="bonus-amount">+${e.amount}</span></div>`).join(`
`)}
    </section>`}function _e(o){return o.priorityActions.length===0?'<p class="muted">Nothing to do \u2014 your governance is in great shape.</p>':`<ol class="action-list">${o.priorityActions.map(e=>`<li>${S(e)}</li>`).join(`
`)}</ol>`}function C(o,e){let t=typeof e=="boolean"?e?"\u2713":"\u2717":String(e),s=typeof e=="boolean"?e?"good":"bad":"";return`<tr><td>${S(o)}</td><td class="${s}">${S(t)}</td></tr>`}function S(o){return String(o).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function Le(o){let{score:e,grade:t}=o,s=Ne(t);return`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline';" />
  <title>Prometheus Health</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 24px;
      max-width: 720px;
    }

    /* \u2500\u2500 Header \u2500\u2500 */
    .header {
      display: flex;
      align-items: center;
      gap: 24px;
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
    }

    .score-circle {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      border: 4px solid ${s};
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .score-number {
      font-size: 28px;
      font-weight: 700;
      line-height: 1;
      color: ${s};
    }

    .score-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.6;
      margin-top: 2px;
    }

    .header-meta h1 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .grade-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      background: ${s};
      color: var(--vscode-editor-background);
      font-weight: 700;
      font-size: 13px;
      margin-bottom: 8px;
    }

    .header-meta p {
      opacity: 0.7;
      font-size: 12px;
    }

    /* \u2500\u2500 Score bar \u2500\u2500 */
    .score-bar-track {
      height: 6px;
      background: var(--vscode-progressBar-background, #3c3c3c);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 10px;
    }

    .score-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.4s ease;
    }

    /* \u2500\u2500 Cards \u2500\u2500 */
    .card {
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-panel-border, #3c3c3c);
      border-radius: 6px;
      padding: 16px 20px;
      margin-bottom: 16px;
    }

    .card h2 {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.6;
      margin-bottom: 12px;
    }

    /* \u2500\u2500 Deductions \u2500\u2500 */
    .deduction-row {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 8px;
      padding: 6px 0;
      border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
    }

    .deduction-row:last-child { border-bottom: none; }

    .deduction-label { flex: 1; }

    .deduction-amount {
      color: var(--vscode-charts-red, #f48771);
      font-weight: 600;
      font-size: 12px;
    }

    .deduction-detail {
      width: 100%;
      opacity: 0.6;
      font-size: 11px;
      margin-top: 2px;
    }

    /* \u2500\u2500 Bonuses \u2500\u2500 */
    .bonus-row {
      display: flex;
      justify-content: space-between;
      padding: 5px 0;
    }

    .bonus-amount {
      color: var(--vscode-charts-green, #73c991);
      font-weight: 600;
    }

    /* \u2500\u2500 Actions \u2500\u2500 */
    .action-list {
      padding-left: 18px;
    }

    .action-list li {
      padding: 4px 0;
      line-height: 1.5;
    }

    /* \u2500\u2500 Totals table \u2500\u2500 */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    td {
      padding: 5px 0;
      border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
    }

    tr:last-child td { border-bottom: none; }

    td:last-child {
      text-align: right;
      font-weight: 600;
    }

    .good { color: var(--vscode-charts-green, #73c991); }
    .bad  { color: var(--vscode-charts-red,   #f48771); }

    .muted { opacity: 0.6; font-size: 12px; }

    /* \u2500\u2500 Footer \u2500\u2500 */
    .footer {
      margin-top: 24px;
      opacity: 0.45;
      font-size: 11px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="score-circle">
      <span class="score-number">${S(String(e))}</span>
      <span class="score-label">/ 100</span>
    </div>
    <div class="header-meta">
      <h1>Governance Health</h1>
      <span class="grade-badge">${S(t)}</span>
      <p>Prometheus Governance \xB7 Holley Studios</p>
      ${Oe(e)}
    </div>
  </div>

  <section class="card">
    <h2>Priority Actions</h2>
    ${_e(o)}
  </section>

  <section class="card">
    <h2>Deductions</h2>
    ${We(o)}
  </section>

  ${je(o)}

  <section class="card">
    <h2>Breakdown</h2>
    <table>
      ${C("New findings",o.totals.newFindings)}
      ${C("Baselined findings",o.totals.baselineFindings)}
      ${C("Drift events",o.totals.driftEvents)}
      ${C("Suppression issues",o.totals.suppressionIssues)}
      ${C("Baseline exists",o.totals.hasBaseline)}
      ${C("Scan report exists",o.totals.hasReport)}
      ${C("Report is fresh",o.totals.reportFresh)}
    </table>
  </section>

  <p class="footer">Prometheus Governance by Holley Studios</p>
</body>
</html>`}function P(o){if(o instanceof T){n.window.showErrorMessage(`Prometheus Governance: ${o.message}`,"Install now").then(t=>{if(t==="Install now"){let s=n.window.createTerminal("Prometheus");s.sendText("npm install --save-dev prometheus-governance"),s.show()}});return}if(o instanceof b){n.window.showWarningMessage(`Prometheus Governance: ${o.message}`,"Scan now").then(t=>{t==="Scan now"&&n.commands.executeCommand("prometheus.scan")});return}let e=o instanceof Error?o.message:String(o);n.window.showErrorMessage(`Prometheus Governance: ${e}`)}function ye(o,e,t,s,c,r){let d=[];return d.push(n.commands.registerCommand("prometheus.scan",async()=>{let i=t();i.enable&&await n.window.withProgress({location:n.ProgressLocation.Notification,title:"Prometheus: Scanning repository\u2026",cancellable:!1},async()=>{try{await be(e,i.binaryPath||void 0),n.window.showInformationMessage("Prometheus: Scan complete. Refreshing findings\u2026"),await s()}catch(a){P(a)}})})),d.push(n.commands.registerCommand("prometheus.reviewFile",async()=>{if(!t().enable)return;let a=n.window.activeTextEditor?.document;if(!a){n.window.showWarningMessage("Prometheus: No active file to review.");return}try{await c(a.uri),n.window.showInformationMessage(`Prometheus: Review complete for ${a.fileName.split("/").pop()}`)}catch(l){P(l)}})),d.push(n.commands.registerCommand("prometheus.health",async()=>{let i=t();i.enable&&await n.window.withProgress({location:n.ProgressLocation.Notification,title:"Prometheus: Loading health score\u2026",cancellable:!1},async()=>{try{let a=await q(e,i.binaryPath||void 0);X.show(o.extensionUri,a)}catch(a){P(a)}})})),d.push(n.commands.registerCommand("prometheus.adapters",async()=>{let i=t();i.enable&&await n.window.withProgress({location:n.ProgressLocation.Notification,title:"Prometheus: Regenerating AI adapters\u2026",cancellable:!1},async()=>{try{await xe(e,i.binaryPath||void 0),n.window.showInformationMessage("Prometheus: AI adapter files updated (CLAUDE.md, GEMINI.md, .cursor/rules, \u2026)")}catch(a){P(a)}})})),d.push(n.commands.registerCommand("prometheus.openConfig",async()=>{let i=(0,ne.join)(e,".prometheus","config.json");if(!(0,M.existsSync)(i)){n.window.showWarningMessage('Prometheus: .prometheus/config.json not found. Run "Prometheus: Scan Repository" first.');return}let a=await n.workspace.openTextDocument(n.Uri.file(i));await n.window.showTextDocument(a)})),d.push(n.commands.registerCommand("prometheus.refreshFindings",async()=>{if(t().enable)try{await s()}catch(a){P(a)}})),d.push(n.commands.registerCommand("prometheus.autopilot.generate",async()=>{let i=await n.window.showInputBox({prompt:"Describe what you want to build",placeHolder:"e.g. add Stripe checkout to the Express app",ignoreFocusOut:!0});if(!i)return;let a=n.window.createTerminal({name:"Prometheus Autopilot",cwd:e});a.sendText(`prometheus autopilot generate "${i.replace(/"/g,'\\"')}"`),a.show(),n.window.showInformationMessage("Prometheus Autopilot: Generating plan in terminal. Answer the clarifying questions, then validate with: prometheus autopilot validate MASTER_PLAN.md")})),d.push(n.commands.registerCommand("prometheus.autopilot.cancel",async()=>{let i=r().session;if(!i){n.window.showWarningMessage("Prometheus Autopilot: No active session to cancel.");return}if(await n.window.showWarningMessage(`Cancel autopilot session "${i.planSlug}"? The current task will complete before stopping.`,{modal:!0},"Cancel Session")!=="Cancel Session")return;let l=(0,ne.join)(e,".prometheus","autopilot",".cancel");try{(0,M.writeFileSync)(l,"","utf8"),n.window.showInformationMessage("Prometheus Autopilot: Cancel signal sent. Session will stop after the current task.")}catch(p){let v=p instanceof Error?p.message:String(p);n.window.showErrorMessage(`Prometheus Autopilot: Could not create cancel sentinel: ${v}`)}})),d.push(n.commands.registerCommand("prometheus.autopilot.review",async()=>{let i=r().session;if(!i){n.window.showWarningMessage("Prometheus Autopilot: No active session. Provide a session ID in the terminal: prometheus autopilot review <id>");return}let l=n.workspace.getConfiguration("prometheus").get("autopilot.baseBranch","main"),p=n.window.createTerminal({name:"Prometheus Review",cwd:e});p.sendText(`prometheus autopilot review ${i.id} --base=${l}`),p.show()})),d.push(n.commands.registerCommand("prometheus.autopilot.openPR",async()=>{let i=r().session;if(!i){n.window.showWarningMessage("Prometheus Autopilot: No active session.");return}let a=n.window.createTerminal({name:"Prometheus PR",cwd:e});a.sendText(`prometheus autopilot open-pr ${i.id}`),a.show()})),d.push(n.commands.registerCommand("prometheus.autopilot.viewJournal",async()=>{let i=r().session;if(!i){n.window.showWarningMessage("Prometheus Autopilot: No active session.");return}if(!(0,M.existsSync)(i.journalPath)){n.window.showWarningMessage(`Prometheus Autopilot: Journal not found at ${i.journalPath}`);return}let a=await n.workspace.openTextDocument(n.Uri.file(i.journalPath));await n.window.showTextDocument(a,{preview:!0})})),d.push(n.commands.registerCommand("prometheus.autopilot.revert",async()=>{let i=r().session;if(!i){n.window.showWarningMessage("Prometheus Autopilot: No active session to revert.");return}if(await n.window.showWarningMessage(`Revert session "${i.planSlug}"? This deletes branch "${i.branch}" and cannot be undone.`,{modal:!0},"Revert and Delete Branch")==="Revert and Delete Branch")try{await R(e,["autopilot","revert",i.id]),n.window.showInformationMessage(`Prometheus Autopilot: Session reverted. Branch "${i.branch}" deleted. main is unchanged.`)}catch(l){let p=l instanceof Error?l.message:String(l);n.window.showErrorMessage(`Prometheus Autopilot: Revert failed: ${p}`)}})),d.push(n.commands.registerCommand("prometheus.importScan",()=>{if(!t().enable)return;let a=n.window.createTerminal({name:"Prometheus: Import Scan",cwd:e});a.sendText("prometheus import:scan"),a.show()})),d.push(n.commands.registerCommand("prometheus.debtScan",()=>{if(!t().enable)return;let a=n.window.createTerminal({name:"Prometheus: Debt Scan",cwd:e});a.sendText("prometheus debt:scan"),a.show()})),d.push(n.commands.registerCommand("prometheus.contextSnapshot",async()=>{let i=t();i.enable&&await n.window.withProgress({location:n.ProgressLocation.Notification,title:"Prometheus: Snapshotting project context\u2026",cancellable:!1},async()=>{try{await R(e,["context:snapshot"],i.binaryPath||void 0),n.window.showInformationMessage("Prometheus: Context snapshot written to .prometheus/context.md")}catch(a){P(a)}})})),d.push(n.commands.registerCommand("prometheus.contextHealth",async()=>{let i=t();i.enable&&await n.window.withProgress({location:n.ProgressLocation.Notification,title:"Prometheus: Checking context health\u2026",cancellable:!1},async()=>{try{let a=await R(e,["context:health"],i.binaryPath||void 0),l=a.split(`
`).find(p=>p.trim().startsWith("Context Health:"))??a.trim();n.window.showInformationMessage(`Prometheus: ${l.trim()}`)}catch(a){P(a)}})})),d.push(n.commands.registerCommand("prometheus.scopeInit",()=>{if(!t().enable)return;let a=n.window.createTerminal({name:"Prometheus: Scope Init",cwd:e});a.sendText("prometheus scope:init"),a.show()})),d.push(n.commands.registerCommand("prometheus.scopeStatus",()=>{if(!t().enable)return;let a=n.window.createTerminal({name:"Prometheus: Scope Status",cwd:e});a.sendText("prometheus scope:status"),a.show()})),d.push(n.commands.registerCommand("prometheus.scopeCheck",async()=>{if(!t().enable)return;let a=await n.window.showInputBox({prompt:"Enter a file path or shell command to check against scope",placeHolder:"e.g.  src/api/users.ts  or  rm -rf ./dist",ignoreFocusOut:!0});if(!a)return;let l=n.window.createTerminal({name:"Prometheus: Scope Check",cwd:e});l.sendText(`prometheus scope:check "${a.replace(/"/g,'\\"')}"`),l.show()})),d.push(n.commands.registerCommand("prometheus.tokensReport",()=>{if(!t().enable)return;let a=n.window.createTerminal({name:"Prometheus: Token Report",cwd:e});a.sendText("prometheus tokens:report"),a.show()})),d.push(n.commands.registerCommand("prometheus.tokensReset",async()=>{let i=t();if(!(!i.enable||await n.window.showWarningMessage("Reset the current session token budget counter?",{modal:!0},"Reset Session")!=="Reset Session"))try{await R(e,["tokens:reset","--session"],i.binaryPath||void 0),n.window.showInformationMessage("Prometheus: Session token budget reset.")}catch(l){P(l)}})),d.push(n.commands.registerCommand("prometheus.tokensBudget",()=>{if(!t().enable)return;let a=n.window.createTerminal({name:"Prometheus: Token Budget",cwd:e});a.sendText("prometheus tokens:budget"),a.show()})),n.Disposable.from(...d)}var E=w(require("vscode")),Te=require("node:path"),Ge={BLOCKER:"\u{1F534}",HIGH:"\u{1F7E0}",MEDIUM:"\u{1F7E1}",LOW:"\u{1F535}",TECH_DEBT:"\u26AA"},Q=class{constructor(e,t){this.workspaceRoot=e;this.getFindings=t}provideHover(e,t){let s=(0,Te.relative)(this.workspaceRoot,e.uri.fsPath).replace(/\\/g,"/");if(s.startsWith(".."))return null;let c=t.line+1,r=this.getFindings().filter(l=>l.file===s&&(l.line??1)===c);if(r.length===0)return null;let d=new E.MarkdownString("",!0);d.isTrusted=!1;for(let l=0;l<r.length;l++){let p=r[l],v=Ge[p.severity]??"\u2B1C";d.appendMarkdown(`**${v} ${p.severity}** &nbsp;\xB7&nbsp; \`${p.category}\`

`),d.appendMarkdown(`${p.message}

`),p.suggestion&&d.appendMarkdown(`**Fix:** ${p.suggestion}

`),l<r.length-1&&d.appendMarkdown(`---

`)}d.appendMarkdown(`---
_Prometheus Governance \u2014 use the \u{1F4A1} lightbulb to suppress_`);let i=t.line,a=new E.Range(i,0,i,Number.MAX_SAFE_INTEGER);return new E.Hover(d,a)}};var x=w(require("vscode")),Ue="Prometheus",H=class{static providedCodeActionKinds=[x.CodeActionKind.QuickFix];provideCodeActions(e,t,s){return s.diagnostics.filter(r=>r.source===Ue&&typeof r.code=="string").flatMap(r=>{let d=r.code,i=r.range.start.line,a=e.lineAt(i).text,p=`${/^(\s*)/.exec(a)?.[1]??""}// prometheus-disable-next-line ${d} -- reason: TODO
`,v=new x.CodeAction(`Suppress: ${d} (add prometheus-disable-next-line comment)`,x.CodeActionKind.QuickFix);return v.diagnostics=[r],v.isPreferred=!1,v.edit=new x.WorkspaceEdit,v.edit.insert(e.uri,new x.Position(i,0),p),[v]})}};function $(){let o=m.workspace.getConfiguration("prometheus");return{enable:o.get("enable",!0),runOnSave:o.get("runOnSave",!0),debounceMs:o.get("debounceMs",1e3),showStatusBar:o.get("showStatusBar",!0),binaryPath:o.get("binaryPath",""),autoScan:o.get("autoScan",!1)}}var re=class{constructor(e,t){this.context=e;this.workspaceRoot=t,this.diagnostics=new j,this.statusBar=new _,this.treeProvider=new G,this.autopilotWatcher=new V(t),this.autopilotView=new K(t,this.autopilotWatcher),this.disposables.push(this.diagnostics,this.statusBar,this.treeProvider,this.autopilotWatcher,this.autopilotView),this.autopilotWatcher.onDidChange(s=>{if(!s){this.statusBar.clearAutopilotSession();return}let c=s.completedTaskIndexes.length,r=c+s.blockedTasks.length+s.timedOutTaskIndexes.length,d=`${c}/${r>0?r:"?"} tasks`;this.statusBar.showAutopilotSession(d,this.autopilotWatcher.isCancelling)})}disposables=[];diagnostics;statusBar;treeProvider;autopilotWatcher;autopilotView;workspaceRoot;allFindings=[];debounceTimer;async activate(){let e=$();if(!e.enable)return;let t=m.window.createTreeView("prometheus.findingsView",{treeDataProvider:this.treeProvider,showCollapseAll:!0});this.disposables.push(t);let s=m.window.createTreeView("prometheus.autopilotView",{treeDataProvider:this.autopilotView,showCollapseAll:!1});this.disposables.push(s),await m.commands.executeCommand("setContext","prometheus.active",!0);let c=ye(this.context,this.workspaceRoot,$,()=>this.runFullReview(),l=>this.reviewSingleFile(l),()=>this.autopilotWatcher);this.disposables.push(c);let r=m.languages.registerHoverProvider({scheme:"file"},new Q(this.workspaceRoot,()=>this.allFindings));this.disposables.push(r);let d=m.languages.registerCodeActionsProvider({scheme:"file"},new H,{providedCodeActionKinds:H.providedCodeActionKinds});this.disposables.push(d);let i=m.workspace.onDidSaveTextDocument(l=>{let p=$();!p.enable||!p.runOnSave||this.isWatchedFile(l.uri)&&(clearTimeout(this.debounceTimer),this.debounceTimer=setTimeout(()=>void this.reviewSingleFile(l.uri),p.debounceMs))});this.disposables.push(i);let a=m.workspace.onDidChangeConfiguration(l=>{l.affectsConfiguration("prometheus")&&($().showStatusBar?this.statusBar.show():this.statusBar.hide())});this.disposables.push(a),e.showStatusBar||this.statusBar.hide(),await this.runInitialAnalysis(e)}async runInitialAnalysis(e){if(!we(this.workspaceRoot,e.binaryPath||void 0)){this.statusBar.showNotInstalled(),this.treeProvider.setNotInstalled(),m.window.showWarningMessage("Prometheus Governance: prometheus-governance is not installed in this project.","Install","Dismiss").then(t=>{if(t==="Install"){let s=m.window.createTerminal("Prometheus");s.sendText("npm install --save-dev prometheus-governance"),s.show()}});return}if(!oe(this.workspaceRoot)){this.statusBar.showScanNeeded(),this.treeProvider.setNoReport(),e.autoScan?m.commands.executeCommand("prometheus.scan"):m.window.showInformationMessage("Prometheus Governance: No scan report found.","Scan now","Dismiss").then(t=>{t==="Scan now"&&m.commands.executeCommand("prometheus.scan")});return}await this.runFullReview()}async runFullReview(){let e=$();this.statusBar.showLoading(),this.treeProvider.setLoading();try{let t=await se(this.workspaceRoot,e.binaryPath||void 0);this.allFindings=t.findings,this.diagnostics.setAll(this.allFindings,this.workspaceRoot),this.treeProvider.refresh(this.allFindings,this.workspaceRoot),await this.refreshStatusBar(e)}catch(t){this.handleAnalysisError(t)}}async reviewSingleFile(e){let t=$();if(!oe(this.workspaceRoot))return;let s=(0,ie.relative)(this.workspaceRoot,e.fsPath);if(!(s.startsWith("..")||s.startsWith("/")))try{let c=await se(this.workspaceRoot,t.binaryPath||void 0,[s]);this.allFindings=[...this.allFindings.filter(r=>r.file!==s),...c.findings],this.diagnostics.setForFile(e,c.findings),this.treeProvider.refresh(this.allFindings,this.workspaceRoot),await this.refreshStatusBar(t)}catch(c){c instanceof b||this.handleAnalysisError(c)}}async refreshStatusBar(e){if(e.showStatusBar)try{let t=await q(this.workspaceRoot,e.binaryPath||void 0);this.statusBar.showHealth(t,this.allFindings.length)}catch{this.statusBar.showInactive()}}handleAnalysisError(e){if(e instanceof T){this.statusBar.showNotInstalled(),this.treeProvider.setNotInstalled();return}if(e instanceof b){this.statusBar.showScanNeeded(),this.treeProvider.setNoReport();return}let t=e instanceof Error?e.message:String(e);this.statusBar.showInactive(),m.window.showErrorMessage(`Prometheus Governance: ${t}`)}isWatchedFile(e){let t=(0,ie.relative)(this.workspaceRoot,e.fsPath);if(t.startsWith("..")||t.startsWith("node_modules")||t.startsWith(".git")||t.startsWith(".prometheus")||t.startsWith("dist/"))return!1;let s=e.fsPath.slice(e.fsPath.lastIndexOf("."));return[".ts",".tsx",".js",".jsx",".mjs",".cjs",".json",".mdx"].includes(s)}dispose(){clearTimeout(this.debounceTimer),m.commands.executeCommand("setContext","prometheus.active",!1);for(let e of this.disposables)e.dispose()}},N;async function Ve(o){let e=m.workspace.workspaceFolders;if(!e||e.length===0)return;let t=e[0].uri.fsPath;N=new re(o,t),o.subscriptions.push(N),await N.activate()}function Ke(){N?.dispose(),N=void 0}0&&(module.exports={activate,deactivate});
//# sourceMappingURL=extension.js.map
