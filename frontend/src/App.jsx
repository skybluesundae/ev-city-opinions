import { useEffect, useMemo, useState } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import world from 'world-atlas/countries-110m.json';
import {
  BarChart3, ChevronDown, CircleHelp, Database, Download, FileUp, Filter,
  Globe2, MapPin, MessageSquareText, RefreshCw, Search, ShieldAlert, Sparkles, X
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
const COLORS = { Negative: '#C36363', Neutral: '#bac6ca', Positive: '#99D699', 'Needs review': '#DDCD69' };
const SENTIMENT_ORDER = ['Positive', 'Neutral', 'Negative', 'Needs review'];
const india = feature(world, world.objects.countries).features.find(country => String(country.id) === '356');
const projection = geoMercator().fitExtent([[28, 30], [530, 520]], india);
const indiaPath = geoPath(projection)(india);

function sentimentColor(score) {
  if (score == null) return '#a4b1b5';
  if (score > 0.16) return '#99D699';
  if (score < -0.16) return '#C36363';
  return '#DDCD69';
}
function themeColor(share) {
  if (share == null) return '#a4b1b5';
  const t = Math.min(1, Math.max(0, share));
  return `hsl(${177 - 26 * t} ${48 + 21 * t}% ${64 - 28 * t}%)`;
}
function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
function downloadCorrections(overrides) {
  const rows = Object.entries(overrides).map(([id, label]) => `${csvCell(id)},${csvCell(label)}`);
  const blob = new Blob([['id,review_label', ...rows].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'sentiment_corrections.csv'; link.click();
  URL.revokeObjectURL(url);
}

function CityMap({ rows, mode, selectedTheme, onSelect, activeCity }) {
  const [hovered, setHovered] = useState(null);
  const maxPosts = Math.max(1, ...rows.map(row => row.posts));
  return <div className="map-frame">
    <svg viewBox="0 0 560 550" role="img" aria-label="Map of India with city bubbles sized by discussion volume">
      <defs><pattern id="mapDots" width="11" height="11" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="#d8e2de" /></pattern></defs>
      <path d={indiaPath} fill="#e7eee9" stroke="#c9d8d1" strokeWidth="1.4" />
      <path d={indiaPath} fill="url(#mapDots)" opacity="0.45" />
      {rows.map(row => {
        const point = projection([row.lon, row.lat]);
        if (!point) return null;
        const [x, y] = point;
        const radius = 8 + 13 * Math.sqrt(row.posts / maxPosts);
        const fill = mode === 'sentiment' ? sentimentColor(row.mean_sentiment) : themeColor(row.theme_share);
        const active = hovered === row.city || activeCity === row.city;
        return <g key={row.city} className="city-pin" onMouseEnter={() => setHovered(row.city)} onMouseLeave={() => setHovered(null)} onClick={() => onSelect(activeCity === row.city ? null : row.city)} tabIndex="0" role="button" aria-label={`${row.city}: ${row.posts} posts`} onKeyDown={e => { if (e.key === 'Enter') onSelect(row.city); }}>
          <circle cx={x} cy={y} r={radius + (active ? 8 : 5)} fill={fill} opacity="0.15" />
          <circle cx={x} cy={y} r={radius} fill={fill} stroke="#fff" strokeWidth="2.5" />
          <circle cx={x} cy={y} r="2.3" fill="#fff" />
          {active && <g transform={`translate(${x + radius + 10}, ${y - 24})`}><rect x="0" y="0" width="145" height="49" rx="9" fill="#102d33" /><text x="12" y="18" fill="white" fontSize="12" fontWeight="700">{row.city}</text><text x="12" y="36" fill="#a9c7c6" fontSize="10">{row.posts} posts · {mode === 'sentiment' ? (row.mean_sentiment == null ? 'unscored' : row.mean_sentiment.toFixed(2)) : `${Math.round((row.theme_share || 0) * 100)}% theme`}</text></g>}
        </g>;
      })}
    </svg>
    <div className="map-legend"><span>LOW</span><div className={mode === 'sentiment' ? 'legend-gradient sentiment-gradient' : 'legend-gradient theme-gradient'} /><span>HIGH</span></div>
    <p className="map-footnote">Locations are approximate city coordinates. Bubble area reflects post volume.</p>
  </div>;
}

function SectionTitle({ eyebrow, title, subtitle, right }) {
  return <div className="section-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{right}</div>;
}

export default function App() {
  const [meta, setMeta] = useState(null);
  const [topic, setTopic] = useState('Electric vehicles');
  const [keywords, setKeywords] = useState('EV, electric car, electric vehicle');
  const [cities, setCities] = useState([]);
  const [file, setFile] = useState(null);
  const [data, setData] = useState(null);
  const [appliedTopic, setAppliedTopic] = useState('Electric vehicles');
  const [appliedKeywords, setAppliedKeywords] = useState('EV, electric car, electric vehicle');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('sentiment');
  const [selectedTheme, setSelectedTheme] = useState('');
  const [activeCity, setActiveCity] = useState(null);
  const [view, setView] = useState('overview');
  const [overrides, setOverrides] = useState({});
  const [reviewFilter, setReviewFilter] = useState('All posts');
  const [query, setQuery] = useState('');

  async function runAnalysis(next = {}) {
    const keys = next.keywords ?? keywords;
    const name = next.topic ?? topic;
    const chosen = next.cities ?? cities;
    const corrections = next.overrides ?? overrides;
    if (!keys.trim()) { setError('Enter at least one matching word or phrase.'); return; }
    if (!chosen.length) { setError('Choose at least one city.'); return; }
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ keywords: keys, cities: chosen.join(',') });
      const body = new FormData();
      body.append('overrides', JSON.stringify(corrections));
      if (file) body.append('file', file);
      const response = await fetch(`${API}/analyze?${params}`, { method: 'POST', body });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Analysis failed.');
      setData(result); setAppliedTopic(name.trim() || 'Untitled topic'); setAppliedKeywords(keys); setSelectedTheme(result.themes?.[0] || '');
      setActiveCity(null);
    } catch (cause) {
      setError(cause instanceof TypeError ? 'Cannot reach the Python API. Start the backend in a separate VS Code terminal.' : cause.message);
    } finally { setLoading(false); }
  }
  useEffect(() => {
    let live = true;
    fetch(`${API}/metadata`).then(r => { if (!r.ok) throw Error(); return r.json(); }).then(result => {
      if (!live) return;
      setMeta(result); setCities(result.cities);
      runAnalysis({ cities: result.cities });
    }).catch(() => { if (live) setError('Cannot reach the Python API. Start the backend in a separate VS Code terminal.'); });
    return () => { live = false; };
  }, []);

  const rows = data?.city_summary || [];
  const totalScored = rows.reduce((sum, row) => sum + row.scored_posts, 0);
  const reviewCount = rows.reduce((sum, row) => sum + row.needs_review, 0);
  const sentimentRows = rows.map(row => ({ city: row.city, ...(data?.sentiment_mix?.[row.city] || {}) }));
  const themeRows = rows.map(row => ({ city: row.city, ...(data?.theme_shares?.[row.city] || {}) }));
  const visiblePosts = useMemo(() => (reviewFilter === 'All posts' ? (data?.posts || []) : (data?.review_posts || [])).filter(post => {
    if (activeCity && post.city !== activeCity) return false;
    if (reviewFilter === 'Needs review' && post.sentiment !== 'Needs review') return false;
    if (reviewFilter === 'Corrected' && !(post.id in overrides)) return false;
    return !query || `${post.text} ${post.city} ${post.theme}`.toLowerCase().includes(query.toLowerCase());
  }), [data, activeCity, reviewFilter, query, overrides]);
  const positiveApprox = totalScored ? Math.round(rows.reduce((sum, row) => sum + (data?.sentiment_mix?.[row.city]?.Positive || 0) * row.posts, 0) / totalScored * 100) : 0;

  function toggleCity(city) { setCities(current => current.includes(city) ? current.filter(c => c !== city) : [...current, city]); }
  function chooseDemo(demo) { setTopic(demo.name); setKeywords(demo.keywords); setOverrides({}); }
  function correct(post, label) {
    const next = { ...overrides, [post.id]: label };
    setOverrides(next);
    runAnalysis({ overrides: next });
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Globe2 size={23} strokeWidth={2.2} /></div><div><strong>cityscope<span>.</span></strong><small>CONVERSATION EXPLORER</small></div></div>
      <div className="side-rule" />
      <div className="side-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Sections">
        <button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}><BarChart3 size={17} /> Overview</button>
        <button className={view === 'posts' ? 'active' : ''} onClick={() => setView('posts')}><MessageSquareText size={17} /> Explore posts {reviewCount > 0 && <span className="nav-count">{reviewCount}</span>}</button>
      </nav>
      <div className="side-rule space" />
      <div className="side-label">YOUR ANALYSIS</div>
      <label className="field-label" htmlFor="topic">Topic name</label>
      <input id="topic" value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Public transport" />
      <label className="field-label" htmlFor="keywords">Matching terms <span title="Comma separated words or phrases. Only posts containing these terms are analyzed."><CircleHelp size={13}/></span></label>
      <textarea id="keywords" rows="3" value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="metro, subway, transit" />
      <p className="field-help">Separate synonyms with commas. The CSV must contain posts about your topic.</p>
      <div className="field-label row-between">City communities <span>{cities.length}/{meta?.cities.length || 11}</span></div>
      <div className="city-select">
        {(meta?.cities || []).map(city => <label key={city} className="city-option"><input type="checkbox" checked={cities.includes(city)} onChange={() => toggleCity(city)} /><span>{city}</span></label>)}
      </div>
      <label className="upload-box" htmlFor="upload"><FileUp size={20}/><span><strong>{file ? file.name : 'Upload your own CSV'}</strong><small>{file ? 'Click to replace · up to 5 MB' : 'Or use the synthetic demo data'}</small></span></label>
      <input id="upload" type="file" accept=".csv,text/csv" className="hidden-input" onChange={e => { setFile(e.target.files?.[0] || null); setOverrides({}); }} />
      {file && <button className="remove-file" onClick={() => { setFile(null); setOverrides({}); }}>Remove uploaded file <X size={13}/></button>}
      <button className="primary-button" onClick={() => runAnalysis()} disabled={loading}>{loading ? <RefreshCw className="spin" size={17}/> : <Search size={17}/>} {loading ? 'Analyzing…' : 'Analyze conversations'}</button>
      <div className="side-bottom"><span className="online-dot"/> {data ? 'Analysis ready' : 'Waiting for backend'} <span>v0.3</span></div>
    </aside>

    <main className="main">
      <header className="topbar"><div className="breadcrumb">PROJECTS <span>/</span> CITY CONVERSATIONS <span>/</span> {view.toUpperCase()}</div><div className="top-status"><span className="status-dot"/> {data?.source === 'uploaded_csv' ? 'YOUR CSV' : 'SYNTHETIC DEMO'}</div></header>
      <div className="content">
        <div className="hero"><div><span className="eyebrow">EXPLORE THE CONVERSATION</span><h1>{view === 'posts' ? 'Behind the numbers' : 'Different cities. Different perspectives.'}</h1><p>{view === 'posts' ? 'Read the posts behind the charts, spot uncertain sentiment, and correct individual labels.' : 'Understand how local communities talk about the same subject, one city at a time.'}</p></div><div className="hero-icon"><Globe2 size={36}/></div></div>
        <div className="demo-row"><span>TRY A TOPIC</span>{(meta?.demo_topics || []).map(demo => <button key={demo.name} className={keywords === demo.keywords ? 'demo-chip selected' : 'demo-chip'} onClick={() => chooseDemo(demo)}>{demo.name}</button>)}<span className="demo-hint">Then select Analyze</span></div>
        {error && <div className="notice error"><ShieldAlert size={18}/><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={16}/></button></div>}
        {data?.source === 'synthetic_demo' && <div className="notice demo-notice"><Database size={18}/><span><strong>Demo dataset.</strong> These are fictional posts with intentionally varied sentiment and themes. Upload a permitted CSV to analyze your own topic.</span></div>}
        {data && !data.count && <div className="empty-state"><Search size={27}/><h2>No matching posts</h2><p>Try broader keywords, select more cities, or upload data that contains this topic.</p></div>}
        {data?.count > 0 && <>
          <div className="analysis-label"><span className="eyebrow">CURRENT ANALYSIS</span><h2>{appliedTopic}</h2><p>Across {rows.length} city communities · Keywords: {appliedKeywords}</p></div>
          <div className="stats-grid">
            <div className="stat-card"><div className="stat-icon mint"><MessageSquareText size={20}/></div><span>Matching posts</span><strong>{data.count.toLocaleString()}</strong><small>Across your selected cities</small></div>
            <div className="stat-card"><div className="stat-icon blue"><MapPin size={20}/></div><span>City communities</span><strong>{rows.length}</strong><small>With posts on this topic</small></div>
            <div className="stat-card"><div className="stat-icon green"><Sparkles size={20}/></div><span>Positive share</span><strong>{positiveApprox}%</strong><small>Among scored posts · approximate</small></div>
            <div className="stat-card"><div className="stat-icon amber"><ShieldAlert size={20}/></div><span>Needs review</span><strong>{reviewCount}</strong><small>Uncertain sentiment excluded</small></div>
          </div>
          {view === 'overview' ? <>
            <div className="panel-grid"><section className="panel map-panel"><SectionTitle eyebrow="GEOSPATIAL VIEW" title="Conversation map" subtitle="Where the discussion happens, city by city." right={<div className="segment"><button className={mode === 'sentiment' ? 'selected' : ''} onClick={() => setMode('sentiment')}>Sentiment</button><button className={mode === 'theme' ? 'selected' : ''} onClick={() => setMode('theme')}>Theme</button></div>}/>
              {mode === 'theme' && <select className="theme-select" value={selectedTheme} onChange={e => setSelectedTheme(e.target.value)}>{data.themes.map(t => <option key={t} value={t}>{t}</option>)}</select>}
              <CityMap rows={rows.map(row => ({...row, theme_share: data.theme_shares?.[row.city]?.[selectedTheme] ?? 0}))} mode={mode} selectedTheme={selectedTheme} activeCity={activeCity} onSelect={setActiveCity}/>
            </section><section className="panel side-panel"><SectionTitle eyebrow="CITY BREAKDOWN" title="At a glance" subtitle="Choose a city on the map to inspect its figures."/>
              <div className="city-list">{[...rows].sort((a,b) => b.posts-a.posts).map(row => <button key={row.city} className={`city-row ${activeCity === row.city ? 'selected' : ''}`} onClick={() => setActiveCity(activeCity === row.city ? null : row.city)}><span className="city-row-name"><i style={{background: sentimentColor(row.mean_sentiment)}}/>{row.city}</span><span className="city-row-metrics"><strong>{row.posts}</strong><small>posts</small></span><span className="city-score">{row.mean_sentiment == null ? '—' : row.mean_sentiment > 0 ? `+${row.mean_sentiment.toFixed(2)}` : row.mean_sentiment.toFixed(2)}</span></button>)}</div>
              <div className="panel-tip"><CircleHelp size={16}/><span>A city subreddit indicates where a post was shared, not where its author lives.</span></div>
            </section></div>
            <div className="charts-grid"><section className="panel chart-panel"><SectionTitle eyebrow="SENTIMENT" title="Mood by city" subtitle="Share of posts in each sentiment group, including unreviewed posts."/>
              <div className="chart-wrap"><ResponsiveContainer width="100%" height={Math.max(310, rows.length * 37)}><BarChart data={sentimentRows} layout="vertical" margin={{top: 4,right: 20,bottom: 0,left: 10}}><CartesianGrid horizontal={false} stroke="#edf1ed"/><XAxis type="number" domain={[0,1]} tickFormatter={v => `${Math.round(v*100)}%`} axisLine={false} tickLine={false} fontSize={11}/><YAxis dataKey="city" type="category" width={84} axisLine={false} tickLine={false} fontSize={11}/><Tooltip formatter={value => `${Math.round(value * 100)}%`}/>{SENTIMENT_ORDER.map(label => <Bar key={label} dataKey={label} stackId="sentiment" fill={COLORS[label]} barSize={17} />)}</BarChart></ResponsiveContainer></div>
              <div className="chart-legend">{SENTIMENT_ORDER.map(label => <span key={label}><i style={{background: COLORS[label]}}/>{label}</span>)}</div>
            </section><section className="panel chart-panel"><SectionTitle eyebrow="CONVERSATION THEMES" title="What comes up" subtitle="Automated themes assigned to matching posts."/>
              <div className="theme-list">{data.themes.map((theme,i) => {
                const count = rows.reduce((sum,row) => sum + (data.theme_shares?.[row.city]?.[theme] || 0) * row.posts,0);
                return <button key={theme} className="theme-row" onClick={() => {setMode('theme');setSelectedTheme(theme);window.scrollTo({top:250,behavior:'smooth'});}}><span className="theme-num">0{i+1}</span><span><strong>{theme.replaceAll(' · ',' / ')}</strong><small>Theme {i+1} · click to view on map</small></span><span className="theme-percent">{Math.round(count/data.count*100)}%</span></button>;
              })}</div>
              <div className="panel-tip"><CircleHelp size={16}/><span>Themes are machine-generated word clusters. Read posts before interpreting them as concerns.</span></div>
            </section></div>
            <section className="panel keywords-panel"><SectionTitle eyebrow="LOCAL LANGUAGE" title="Distinctive terms" subtitle="Words and phrases that stand out in each city's posts."/>
              <div className="keyword-grid">{Object.entries(data.distinctive_terms || {}).map(([city,terms]) => <div key={city} className="keyword-card"><strong>{city}</strong><p>{terms.slice(0,5).join('  ·  ') || 'Insufficient text'}</p></div>)}</div>
            </section>
          </> : <section className="panel posts-panel"><SectionTitle eyebrow="SOURCE MATERIAL" title="Explore posts" subtitle="Inspect model labels and review posts where a positive phrase may hide a complaint." right={Object.keys(overrides).length > 0 && <button className="outline-button" onClick={() => downloadCorrections(overrides)}><Download size={15}/> Export {Object.keys(overrides).length} corrections</button>}/>
            <div className="posts-tools"><div className="search-field"><Search size={16}/><input placeholder="Search visible posts…" value={query} onChange={e => setQuery(e.target.value)}/></div><div className="filter-box"><Filter size={15}/><select value={reviewFilter} onChange={e => setReviewFilter(e.target.value)}><option>All posts</option><option>Needs review</option><option>Corrected</option></select><ChevronDown size={14}/></div>{activeCity && <button className="clear-city" onClick={() => setActiveCity(null)}>{activeCity} <X size={14}/></button>}</div>
            <div className="post-list">{visiblePosts.length ? visiblePosts.map(post => <article className="post-card" key={post.id}><div className="post-meta"><span><MapPin size={13}/>{post.city}</span><span>{post.date || 'Date unavailable'}</span><span className="post-theme">{post.theme}</span></div><p>{post.text}</p><div className="post-bottom"><span className={`sentiment-badge ${post.sentiment.toLowerCase().replaceAll(' ','-')}`}>{post.sentiment}</span>{post.needs_review && <span className="raw-label">Raw model: {post.raw_sentiment}</span>}{post.needs_review && <div className="review-actions"><span>YOUR LABEL</span>{['Positive','Neutral','Negative'].map(label => <button key={label} className={overrides[post.id] === label ? 'chosen' : ''} onClick={() => correct(post,label)}>{label}</button>)}</div>}</div></article>) : <div className="no-posts">No posts match these filters.</div>}</div>
            <p className="posts-note">Showing up to 500 posts. The review queue includes all flagged posts in the first 200 flagged results. Corrections apply to this browser session; export them to keep a record.</p>
          </section>}
          <footer><span>CityScope · Exploratory analysis tool</span><span>Sentiment and themes require human validation before reporting findings.</span></footer>
        </>}
      </div>
    </main>
  </div>;
}
