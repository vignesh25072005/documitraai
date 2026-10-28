import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, ArrowDown, ArrowUpRight, BookOpen, Bot, Check, CheckCircle2, ChevronDown,
  CircleHelp, Clock3, Command, File, FileCheck2, FileSearch, FileText, Files, FolderOpen,
  Globe2, HardDrive, Info, LoaderCircle, Menu, MessageSquareText, MoreHorizontal, Paperclip,
  Plus, Search, Send, Settings2, ShieldCheck, Sparkles, Trash2, UploadCloud, X, Zap
} from "lucide-react";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const formatBytes = (n=0) => n < 1024*1024 ? `${Math.max(1, Math.round(n/1024))} KB` : `${(n/(1024*1024)).toFixed(1)} MB`;
const formatTime = (s) => { try { return new Date(s).toLocaleDateString(undefined,{month:"short",day:"numeric"}); } catch { return ""; } };

function App() {
  const [documents, setDocuments] = useState([]);
  const [selected, setSelected] = useState([]);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [health, setHealth] = useState({status:"checking", ai_enabled:false, mode:"demo"});
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("chat");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState("");
  const fileRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  async function api(path, options={}) {
    const res = await fetch(`${API}${path}`, options);
    const data = await res.json().catch(()=>({detail:"Unexpected server response"}));
    if (!res.ok) throw new Error(data.detail || "Request failed");
    return data;
  }
  async function refresh() {
    try {
      const [docs, h] = await Promise.all([api("/api/documents"), api("/api/health")]);
      setDocuments(docs); setHealth(h);
      setSelected(prev => prev.filter(id => docs.some(d => d.id === id)));
    } catch {
      setHealth({status:"offline", ai_enabled:false, mode:"demo"});
    }
  }
  useEffect(()=>{ refresh(); const t=setInterval(refresh, 12000); return ()=>clearInterval(t); },[]);
  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth",block:"end"}); },[messages,loading]);
  useEffect(()=>{ if(toast){const t=setTimeout(()=>setToast(""),3000);return()=>clearTimeout(t)} },[toast]);

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true); setError("");
    let success = 0;
    for (const file of files) {
      const body = new FormData(); body.append("file", file);
      try {
        const result = await api("/api/documents/upload", {method:"POST", body});
        setSelected(prev => [...new Set([...prev, result.id])]);
        success++;
      } catch (e) { setError(`${file.name}: ${e.message}`); }
    }
    await refresh(); setUploading(false);
    if (success) { setToast(`${success} document${success>1?"s":""} added to your workspace`); setActiveTab("chat"); }
    if (fileRef.current) fileRef.current.value = "";
  }
  async function removeDoc(id) {
    try {
      await api(`/api/documents/${id}`, {method:"DELETE"});
      setDocuments(prev=>prev.filter(d=>d.id!==id));
      setSelected(prev=>prev.filter(x=>x!==id));
      setToast("Document removed");
    } catch(e){setError(e.message)}
  }
  async function sendQuestion(text=question, mode="ask") {
    const q = text.trim();
    if (!q || loading) return;
    if (!documents.length) { setError("Upload a document first to start asking questions."); return; }
    const userMessage = {role:"user",content:q};
    setMessages(prev=>[...prev,userMessage]);
    setQuestion(""); setLoading(true); setError(""); setActiveTab("chat");
    try {
      const data = await api("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:q,document_ids:selected,mode})});
      setMessages(prev=>[...prev,{role:"assistant",content:data.answer+(data.notice?`\n\n**AI service note:** ${data.notice}`:""),sources:data.sources||[],mode:data.mode}]);
    } catch(e) {
      setMessages(prev=>[...prev,{role:"assistant",content:`I couldn't complete that request. ${e.message}\n\nPlease check that the backend is running and try again.`,sources:[],mode:"error"}]);
    } finally {setLoading(false); inputRef.current?.focus();}
  }
  async function summarize(doc) {
    setLoading(true); setActiveTab("chat"); setMessages(prev=>[...prev,{role:"user",content:`Summarize ${doc.filename}`}]);
    try {
      const data = await api(`/api/documents/${doc.id}/summary`,{method:"POST"});
      setMessages(prev=>[...prev,{role:"assistant",content:data.answer+(data.notice?`\n\n**AI service note:** ${data.notice}`:""),sources:data.sources||[],mode:data.mode}]);
    } catch(e) {setError(e.message)}
    finally {setLoading(false)}
  }
  const filtered = documents.filter(d=>d.filename.toLowerCase().includes(search.toLowerCase()));
  const selectedCount = selected.length || documents.length;
  const prompts = [
    {icon:FileSearch,title:"Give me an overview",desc:"Summarize the main ideas",q:"Summarize the main ideas and key takeaways from my documents."},
    {icon:Search,title:"Find key information",desc:"Locate specific details",q:"What are the most important facts, dates, and requirements in these documents?"},
    {icon:BookOpen,title:"Explain it simply",desc:"Turn complex text into clarity",q:"Explain the key concepts in simple language and define any important terms."},
    {icon:CheckCircle2,title:"Create an action list",desc:"Turn information into next steps",q:"Create a practical checklist of actions and requirements mentioned in these documents."}
  ];

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen?"sidebar-open":""}`}>
      <div className="brand-row">
        <div className="brand-mark"><Files size={20}/></div>
        <div className="brand-name">documitra<span>AI</span><small>DOCUMENT INTELLIGENCE</small></div>
        <button className="icon-button mobile-close" onClick={()=>setSidebarOpen(false)} aria-label="Close sidebar"><X size={18}/></button>
      </div>
      <button className="new-chat" onClick={()=>{setMessages([]);setActiveTab("chat");setError("");setSidebarOpen(false)}}><Plus size={17}/> New conversation <span>⌘ K</span></button>
      <div className="side-label">WORKSPACE</div>
      <button className={`nav-item ${activeTab==="chat"?"nav-active":""}`} onClick={()=>setActiveTab("chat")}><MessageSquareText size={17}/> Ask documents</button>
      <button className={`nav-item ${activeTab==="library"?"nav-active":""}`} onClick={()=>setActiveTab("library")}><FolderOpen size={17}/> Document library <span className="nav-count">{documents.length}</span></button>
      <div className="docs-heading"><span className="side-label">YOUR DOCUMENTS</span><button onClick={()=>fileRef.current?.click()} className="tiny-plus" aria-label="Add document"><Plus size={15}/></button></div>
      <div className="doc-list">
        {documents.length===0 ? <div className="empty-docs"><div className="empty-file"><FileText size={19}/></div><p>No documents yet</p><span>Upload files to build your workspace.</span></div> :
          documents.slice(0,7).map(d=><div className={`doc-nav ${selected.includes(d.id)?"doc-nav-selected":""}`} key={d.id}>
            <button className="doc-select" onClick={()=>setSelected(prev=>prev.includes(d.id)?prev.filter(x=>x!==d.id):[...prev,d.id])} title="Include or exclude from chat">
              <span className={`file-type type-${d.file_type.toLowerCase()}`}>{d.file_type==="PDF"?"PDF":d.file_type==="DOCX"?"DOC":"TXT"}</span><span className="doc-nav-name">{d.filename}</span>
            </button>
            <button className="doc-more" onClick={()=>summarize(d)} title="Summarize document"><Sparkles size={14}/></button>
          </div>)}
      </div>
      <div className="sidebar-spacer"/>
      <div className="privacy-card"><div className="privacy-icon"><ShieldCheck size={17}/></div><div><strong>Your workspace</strong><p>Files stay on this device's local server.</p></div></div>
      <div className="profile-row"><div className="profile-avatar">D</div><div className="profile-copy"><strong>DocuMitra workspace</strong><span>Personal account</span></div><button className="icon-button" title="Workspace details" onClick={()=>setToast("Local workspace · no sign-in required")}><MoreHorizontal size={18}/></button></div>
    </aside>

    {sidebarOpen&&<button className="mobile-overlay" onClick={()=>setSidebarOpen(false)} aria-label="Close navigation"/>}
    <main className="main-area">
      <header className="topbar">
        <div className="top-left"><button className="icon-button mobile-menu" onClick={()=>setSidebarOpen(true)} aria-label="Open navigation"><Menu size={20}/></button><div className="breadcrumb">Workspace <span>/</span> <strong>{activeTab==="library"?"Document library":"AI assistant"}</strong></div></div>
        <div className="top-actions"><div className={`status-pill ${health.status==="ok"?"status-online":"status-offline"}`}><span className="status-dot"/>{health.status==="ok"?(health.ai_enabled?"Gemini key configured":"Local mode ready"):"API offline"}</div><button className="icon-button" onClick={()=>setToast(health.ai_enabled?"Gemini key is configured; availability depends on Google API quota.":"Local mode is ready. Add GEMINI_API_KEY in backend/.env for Gemini-generated answers.")} title="AI connection status"><CircleHelp size={18}/></button></div>
      </header>

      {activeTab==="library" ? <section className="library-view">
        <div className="page-eyebrow"><span className="eyebrow-line"/> YOUR KNOWLEDGE BASE</div>
        <div className="library-title-row"><div><h1>Document library</h1><p>Keep your important information organized and ready to explore.</p></div><button className="primary-button" onClick={()=>fileRef.current?.click()}><UploadCloud size={17}/> Upload documents</button></div>
        <div className="library-toolbar"><div className="search-box"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search your documents..."/></div><span>{documents.length} {documents.length===1?"document":"documents"}</span></div>
        {filtered.length===0?<div className="library-empty"><FolderOpen size={28}/><h3>{documents.length?"No matching documents":"Your library is ready"}</h3><p>{documents.length?"Try a different search term.":"Upload your first document to start asking questions and generating summaries."}</p><button className="primary-button" onClick={()=>fileRef.current?.click()}><Plus size={16}/> Add your first document</button></div>:
          <div className="library-grid">{filtered.map(d=><article className="library-card" key={d.id}><div className="library-card-top"><div className={`big-file-icon type-${d.file_type.toLowerCase()}`}><FileText size={22}/></div><button className="icon-button danger-hover" title="Delete document" onClick={()=>removeDoc(d.id)}><Trash2 size={16}/></button></div><h3 title={d.filename}>{d.filename}</h3><p className="doc-preview">{d.preview||"No preview available."}</p><div className="library-meta"><span>{formatBytes(d.size_bytes)}</span><span>·</span><span>{d.characters.toLocaleString()} characters</span><span>·</span><span>{formatTime(d.uploaded_at)}</span></div><div className="library-card-actions"><button onClick={()=>{setSelected([d.id]);setActiveTab("chat");setMessages([])}}><MessageSquareText size={15}/> Ask this file</button><button onClick={()=>summarize(d)}><Sparkles size={15}/> Summarize</button></div></article>)}</div>}
      </section> : <section className={`chat-view ${messages.length?"chat-has-messages":""}`}>
        {messages.length===0 ? <div className="welcome-wrap">
          <div className="page-eyebrow"><span className="eyebrow-line"/> YOUR DOCUMENTS, UNDERSTOOD</div>
          <div className="hero-title"><h1>Make sense of<br/><span>every document.</span></h1><div className="hero-orb"><div className="orb-core"><Sparkles size={26}/></div><div className="orb-ring ring-one"/><div className="orb-ring ring-two"/><div className="orb-dot dot-one"/><div className="orb-dot dot-two"/></div></div>
          <p className="hero-subtitle">Your AI-powered workspace to explore documents, find answers, and turn complex information into clear next steps.</p>
          <div className="upload-zone" onClick={()=>fileRef.current?.click()} onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add("drag-over")}} onDragLeave={e=>e.currentTarget.classList.remove("drag-over")} onDrop={e=>{e.preventDefault();e.currentTarget.classList.remove("drag-over");uploadFiles(e.dataTransfer.files)}}>
            <div className="upload-icon">{uploading?<LoaderCircle className="spin" size={22}/>:<UploadCloud size={22}/>}</div>
            <div className="upload-copy"><strong>{uploading?"Adding your documents…":"Drop your documents here, or browse"}</strong><span>PDF, DOCX or TXT · Up to 20 MB per file</span></div><button className="browse-button" onClick={e=>{e.stopPropagation();fileRef.current?.click()}}>Browse files <ArrowUpRight size={15}/></button>
          </div>
          {error&&<div className="error-banner"><Info size={16}/>{error}<button onClick={()=>setError("")}><X size={14}/></button></div>}
          <div className="suggestion-heading"><span>WHAT WOULD YOU LIKE TO DO?</span><span className="suggestion-rule"/></div>
          <div className="prompt-grid">{prompts.map((p,i)=><button className="prompt-card" key={p.title} onClick={()=>documents.length?sendQuestion(p.q):fileRef.current?.click()}><div className={`prompt-icon prompt-${i}`}><p.icon size={18}/></div><div><strong>{p.title}</strong><span>{p.desc}</span></div><ArrowUpRight className="prompt-arrow" size={16}/></button>)}</div>
          <div className="trust-row"><div><ShieldCheck size={15}/> Your files stay in your local workspace</div><span className="trust-sep"/> <div><Zap size={14}/> Fast, source-grounded answers</div></div>
        </div> : <div className="conversation">
          <div className="conversation-heading"><div><div className="page-eyebrow"><span className="eyebrow-line"/> DOCUMENT CONVERSATION</div><h2>Let's work through it.</h2><p>Answers are grounded in the documents available to this workspace.</p></div><button className="subtle-button" onClick={()=>setMessages([])}><Plus size={15}/> New chat</button></div>
          {messages.map((m,i)=><div className={`message-row ${m.role==="user"?"user-row":""}`} key={i}><div className={`message-avatar ${m.role==="assistant"?"assistant-avatar":"user-avatar"}`}>{m.role==="assistant"?<Sparkles size={17}/>:<span>Y</span>}</div><div className="message-body"><div className="message-author">{m.role==="assistant"?"DocuMitra AI":"You"}{m.role==="assistant"&&<span className={`answer-mode ${m.mode==="gemini"?"mode-ai":""}`}>{m.mode==="gemini"?"AI GENERATED":m.mode==="local"?"LOCAL SUMMARY":m.mode==="demo"?"LOCAL MODE":m.mode==="error"?"NOTICE":"RESPONSE"}</span>}</div><div className="message-content">{m.content.split("\n").map((line,j)=>line.startsWith("## ")?<h3 key={j}>{line.slice(3)}</h3>:line.startsWith("### ")?<h4 key={j}>{line.slice(4)}</h4>:line.startsWith("> ")?<blockquote key={j}>{line.slice(2)}</blockquote>:line.startsWith("• ")?<div className="bullet-line" key={j}>• {line.slice(2)}</div>:line===""?<div className="line-gap" key={j}/>:<p key={j}>{line.split(/(\*\*.*?\*\*)/g).map((part,k)=>part.startsWith("**")&&part.endsWith("**")?<strong key={k}>{part.slice(2,-2)}</strong>:part)}</p>)}</div>
              {m.sources?.length>0&&<div className="sources-block"><div className="sources-title"><FileCheck2 size={15}/> SOURCES USED <span>{m.sources.length}</span></div><div className="sources-list">{m.sources.slice(0,4).map((s,j)=><div className="source-item" key={j}><div className="source-file-icon"><FileText size={15}/></div><div><strong>{s.filename}</strong><span>{s.reference||"Extracted text"} · {s.snippet}</span></div></div>)}</div></div>}
            </div></div>)}
          {loading&&<div className="message-row"><div className="message-avatar assistant-avatar"><Sparkles size={17}/></div><div className="message-body"><div className="message-author">DocuMitra AI <span className="answer-mode">WORKING</span></div><div className="thinking"><span/><span/><span/> Finding relevant passages and preparing your answer…</div></div></div>}
          <div ref={bottomRef}/>
        </div>}
        <div className={`composer-wrap ${messages.length?"composer-bottom":""}`}>
          {messages.length>0&&<div className="composer-hint"><span className="green-dot"/>{selected.length?`${selected.length} selected document${selected.length>1?"s":""}`:`All ${documents.length} documents`} available as context <span>·</span> AI can make mistakes; verify important details.</div>}
          <form className="composer" onSubmit={e=>{e.preventDefault();sendQuestion()}}>
            <textarea ref={inputRef} value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendQuestion()}}} placeholder={documents.length?"Ask a question about your documents…":"Upload a document to start a conversation"} rows={1} disabled={!documents.length||loading}/>
            <div className="composer-bottom-row"><div className="composer-tools"><button type="button" className="composer-tool" onClick={()=>fileRef.current?.click()} title="Attach document"><Paperclip size={16}/></button><span className="composer-divider"/><span className="model-label"><span className="model-sparkle"><Sparkles size={12}/></span>{health.ai_enabled?"Gemini · Document grounded":"Local retrieval mode"}<ChevronDown size={13}/></span></div><div className="send-side"><span className="enter-hint">↵ to send</span><button className="send-button" type="submit" disabled={!question.trim()||!documents.length||loading} aria-label="Send message">{loading?<LoaderCircle className="spin" size={17}/>:<Send size={16}/>}</button></div></div>
          </form>
          {messages.length===0&&<div className="composer-footnote">DocuMitra AI can make mistakes. Always verify important information against the original source.</div>}
        </div>
      </section>}
      <footer className="footer"><span>© 2026 DocuMitra AI</span><span><span className="footer-dot"/> {health.status==="ok"?"All systems operational":"Connecting to local API…"}</span><button onClick={()=>setToast("DocuMitra AI · Local document intelligence MVP")}><Info size={13}/> About</button></footer>
    </main>
    <input ref={fileRef} type="file" accept=".pdf,.docx,.txt" multiple hidden onChange={e=>uploadFiles(e.target.files)}/>
    {toast&&<div className="toast"><CheckCircle2 size={17}/>{toast}<button onClick={()=>setToast("")}><X size={14}/></button></div>}
  </div>
}

createRoot(document.getElementById("root")).render(<App />);
