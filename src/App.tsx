import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, BarChart3, Bell, Building2, Calculator, Check, ChevronRight, Clipboard, Database, Eye, EyeOff, FileText, Grid2X2, Image as ImageIcon, LayoutDashboard, LockKeyhole, LogOut, Menu, Package, Pencil, Plus, Save, Search, Send, Settings, ShieldCheck, SlidersHorizontal, Tags, Trash2, Users, X, Zap } from 'lucide-react';

type Role = 'admin' | 'seller';
type Profile = { id: string; full_name: string; email: string; role: Role; is_active: boolean };
type Machine = {
  id: string; internal_code?: string | null; brand: string; model: string;
  display_name: string; category: string; category_id?: string | null;
  value: number; entry: number; installment: number; year: number;
  status: string; image?: string; photos: MachinePhoto[];
  power: string; weight: string; hours: string;
  location: string; description?: string; notes?: string;
  applications: string[]; specs: Record<string, string>;
};
type MachinePhoto = {
  public_url?: string; storage_path?: string; is_primary?: boolean;
  is_main?: boolean; photo_type?: string; image_url?: string;
};
type PendingPhoto = {
  tempId: string;
  preview: string;
  file?: File;
  id?: string;
  machine_id?: string;
  storage_path?: string;
  source?: 'machine_photos' | 'machine_images';
  is_primary?: boolean;
  photo_type?: string;
  public_url?: string;
};
type Brand = { id: string; name: string; logo_url?: string; accent_color: string; is_active: boolean };
type Segment = { id: string; name: string; min_term: number; max_term: number };

function normalizeStatus(s: string): string {
  const key = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (['disponivel', 'available', 'ativo'].includes(key)) return 'available';
  if (['negociacao', 'emnegociacao', 'negotiating'].includes(key)) return 'negotiating';
  if (['vendido', 'sold'].includes(key)) return 'sold';
  if (['indisponivel', 'unavailable', 'inativo'].includes(key)) return 'unavailable';
  return 'available';
}

function isPrincipalPhoto(p: MachinePhoto): boolean {
  if (p.is_primary || p.is_main) return true;
  if (typeof p.photo_type === 'string') {
    const k = p.photo_type.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return k === 'principal';
  }
  return false;
}

function mapMachineRow(row: Record<string, unknown>): Machine {
  const cats = row.categories as { name: string } | null | undefined;
  let photos = (row.machine_photos as MachinePhoto[] | null | undefined) ?? [];
  if (photos.length === 0) {
    const fallbackImgs = row.machine_images as MachinePhoto[] | null | undefined;
    if (Array.isArray(fallbackImgs) && fallbackImgs.length > 0) {
      photos = fallbackImgs.map(i => ({
        public_url: i.public_url ?? i.image_url,
        storage_path: i.storage_path,
        is_primary: isPrincipalPhoto(i),
        photo_type: typeof i.photo_type === 'string' ? i.photo_type : 'other'
      }));
    }
  }
  const deduped: MachinePhoto[] = [];
  const seen = new Set<string>();
  for (const p of photos) {
    const key = (p.public_url || '') + '|' + (p.storage_path || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(p);
  }
  const sortedPhotos: MachinePhoto[] = [];
  const primary = deduped.find(isPrincipalPhoto);
  if (primary) sortedPhotos.push(primary);
  for (const p of deduped) if (p !== primary) sortedPhotos.push(p);
  const mainPhoto = sortedPhotos[0];
  return {
    id: String(row.id),
    internal_code: (row.internal_code ?? row.code) as string | null | undefined,
    brand: String(row.brand ?? ''),
    model: String(row.model ?? ''),
    display_name: String(row.display_name ?? `${row.brand ?? ''} ${row.model ?? ''}`).trim(),
    category: cats?.name || String(row.category ?? 'SEM CATEGORIA'),
    category_id: row.category_id as string | null | undefined,
    value: Number(row.value ?? row.price ?? 0),
    entry: Number(row.down_payment ?? 0),
    installment: Number(row.installment ?? 0),
    year: Number(row.manufacture_year ?? row.year ?? new Date().getFullYear()),
    status: normalizeStatus(String(row.status ?? 'available')),
    power: String(row.power ?? 'Não informado'),
    weight: String(row.operating_weight ?? 'Não informado'),
    hours: String(row.hours ?? 'Não informado'),
    location: String(row.location ?? 'Não informado'),
    description: (row.description as string | undefined) ?? undefined,
    notes: (row.notes as string | undefined) ?? undefined,
    applications: (row.applications as string[]) || [],
    specs: (row.specs as Record<string, string>) || {},
    image: mainPhoto?.public_url,
    photos: sortedPhotos,
  };
}



const demoBrands: Brand[] = [
  { id: 'b1', name: 'Eixo Consórcios', accent_color: '#B8963F', is_active: true },
  { id: 'b2', name: 'Promova Online', accent_color: '#B8963F', is_active: true },
];
const demoSegments: Segment[] = [
  { id: 's1', name: 'Bens Pesados', min_term: 12, max_term: 120 },
  { id: 's2', name: 'Veículos', min_term: 12, max_term: 84 },
  { id: 's3', name: 'Imóveis', min_term: 60, max_term: 240 },
];
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (value: string | Date) => new Date(value).toLocaleDateString('pt-BR');
// Mensagem da oferta para copiar/compartilhar (WhatsApp) — usada na vitrine e na página de detalhes
function buildOfferText(m: Machine): string {
  const power = m.power && m.power.toLowerCase() !== 'não informado' ? m.power : '';
  return [
    `🚜 ${m.category} ${m.brand} ${m.model} | ${m.year}`,
    '',
    '🏗️ Informações do Equipamento',
    `🔹 Marca: ${m.brand}`,
    `🔹 Modelo: ${m.model}`,
    `🔹 Ano: ${m.year}`,
    power ? `🔹 Potência: ${power}` : null,
    '',
    '💰 Informações de Valores',
    `💵 Valor total: ${money(m.value)}`,
    `💳 Entrada: ${money(m.entry)}`,
    `📆 Parcela mensal: ${money(m.installment)}/mês`,
  ].filter((line): line is string => line !== null).join('\n');
}
const PAGE_SIZE = 9; // máquinas renderizadas por vez na vitrine (renderização progressiva)

function Logo({ compact = false }: { compact?: boolean }) { return <div className="brand-lockup"><div className="brand-mark" style={{ padding: 0, overflow: 'hidden' }}><img src="/favicon.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} /></div>{!compact && <div><strong>Eixo<span>-Catálogo</span></strong><small>OPERAÇÃO COMERCIAL</small></div>}</div>; }
function Loading() { return <div className="loading-screen"><div className="spinner" /><span>Carregando seu ambiente...</span></div>; }

// Gera uma URL transformada (menor) para imagens do Supabase Storage.
// Se a URL não for do Storage (ou a transformação estiver desabilitada), devolve a original.
function thumbUrl(url: string | undefined | null, width = 480): string {
  if (!url) return '';
  const marker = '/storage/v1/object/public/';
  const i = url.indexOf(marker);
  if (i === -1) return url;
  const prefix = url.slice(0, i);
  const rest = url.slice(i + marker.length);
  const sep = rest.includes('?') ? '&' : '?';
  return `${prefix}/storage/v1/render/image/public/${rest}${sep}width=${width}&quality=72&resize=contain`;
}

// Imagem com lazy-load + thumbnail automático e fallback para a URL original em caso de erro.
function SmartImg({ src, alt, width = 480, priority = false, style, className }: {
  src: string; alt: string; width?: number; priority?: boolean; style?: CSSProperties; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <img
      src={failed || !src ? src : thumbUrl(src, width)}
      alt={alt}
      className={className}
      style={style}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

async function getProfile(userId: string): Promise<Profile> {
  // 1) Tenta TABELA NOVA usuarios_perfil (estrutura do usuário: id, nome, papel, criado_em)
  let data: Record<string, unknown> | null = null;
  let fallbackEmail: string | null = null;
  try {
    const sessRes = await supabase.auth.getSession();
    const sess = (sessRes as { data?: { session?: { user?: { email?: string } } } }).data?.session;
    if (sess?.user?.email) fallbackEmail = sess.user.email;
  } catch { /* ignore */ }
  const up = await supabase
    .from('usuarios_perfil')
    .select('id, nome, papel, criado_em')
    .eq('id', userId)
    .maybeSingle();
  if (up.error) {
    // 2) Fallback para tabela profiles antiga (compat retroativa)
    const pf = await supabase
      .from('profiles')
      .select('id, name, full_name, email, role, active, is_active')
      .eq('id', userId)
      .maybeSingle();
    if (pf.error || !pf.data) throw new Error('profile_missing');
    const row = pf.data as Record<string, unknown>;
    const rawRole = String(row.role ?? 'seller');
    const profile: Profile = {
      id: String(row.id),
      full_name: String(row.full_name ?? row.name ?? ''),
      email: String(row.email ?? fallbackEmail ?? ''),
      role: (rawRole === 'vendedor' ? 'seller' : rawRole) as Role,
      is_active: Boolean(row.is_active ?? row.active ?? true),
    };
    if (!profile.is_active) throw new Error('profile_inactive');
    if (!profile.full_name) throw new Error('profile_missing');
    return profile;
  }
  if (!up.data) throw new Error('profile_missing');
  data = up.data as Record<string, unknown>;
  const rawPapel = String(data.papel ?? 'vendedor').toLowerCase();
  const profile: Profile = {
    id: String(data.id),
    full_name: String(data.nome ?? ''),
    email: fallbackEmail ?? '',
    role: (rawPapel === 'admin' || rawPapel === 'administrador' || rawPapel === 'adm') ? 'admin' : 'seller',
    is_active: true,
  };
  if (!profile.full_name) throw new Error('profile_missing');
  return profile;
}

function Auth({ onAuth }: { onAuth: (profile: Profile) => void }) {
  const [mode, setMode] = useState<'login' | 'bootstrap'>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [needsConfirm, setNeedsConfirm] = useState(false); const [resent, setResent] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setNeedsConfirm(false); setResent(false);
    if (password.length < 8 || !email || (mode === 'bootstrap' && name.trim().length < 2)) {
      setError('Informe os dados obrigatórios corretamente.'); return;
    }
    setBusy(true);
    try {
      const response = mode === 'bootstrap'
        ? await supabase.auth.signUp({
            email,
            password,
            options: {
              data: { nome: name.trim(), name: name.trim(), full_name: name.trim(), papel: 'admin' },
              emailRedirectTo: location.origin,
            }
          })
        : await supabase.auth.signInWithPassword({ email, password });
      if (response.error || !response.data.user || !response.data.session) {
        throw new Error(response.error?.message || 'auth');
      }
      const user = response.data.user;
      if (mode === 'bootstrap') {
        // Garante linha em usuarios_perfil (trigger handle_new_user já deve ter criado, mas tenta explicitamente por seguranca)
        try {
          const { error: upErr } = await supabase
            .from('usuarios_perfil')
            .insert({ id: user.id, nome: name.trim(), papel: 'admin' });
          if (upErr) {
            // fallback para tabela profiles antiga se usuarios_perfil nao existir ainda
            const baseRow = { id: user.id, name: name.trim(), full_name: name.trim(), email: user.email ?? email, active: true, is_active: true };
            await supabase.from('profiles').insert({ ...baseRow, role: 'admin' });
          }
        } catch (e) { /* ignore: trigger should have handled it */ }
      }
      onAuth(await getProfile(user.id));
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : '';
      if (raw === 'profile_inactive') {
        setError('Este usuário está desativado. Fale com um administrador.');
      } else if (/email not confirmed|email_not_confirmed/i.test(raw)) {
        setNeedsConfirm(true);
        setError('Seu e-mail ainda não foi confirmado. Abra o link enviado para ' + email + ' (verifique também Spam/Lixo eletrônico) e tente novamente.');
      } else if (/invalid login credentials/i.test(raw)) {
        setError('E-mail ou senha incorretos. Confira os dados e tente novamente.');
      } else if (mode === 'bootstrap') {
        setError('Não foi possível criar o administrador inicial. Verifique se já existe um administrador.');
      } else {
        setError('Não foi possível entrar. Tente novamente.');
      }
    } finally {
      setBusy(false);
    }
  };

  const resendConfirmation = async () => {
    setError(''); setResent(false); setBusy(true);
    try {
      const { error: e } = await supabase.auth.resend({ type: 'signup', email });
      if (e) throw e;
      setResent(true);
    } catch {
      setError('Não foi possível reenviar o e-mail agora. Tente novamente em instantes.');
    } finally {
      setBusy(false);
    }
  };
  return <main className="auth-shell"><div className="auth-glow" /><section className="auth-panel"><div className="auth-logo"><Logo /></div><div className="auth-card"><div className="eyebrow"><LockKeyhole size={16} /> ACESSO RESTRITO</div><h1>{mode === 'login' ? 'Acesso da equipe' : 'Administrador inicial'}</h1><p className="muted">{mode === 'login' ? 'Entre para consultar o catálogo e criar propostas.' : 'Crie o primeiro acesso administrativo do seu catálogo.'}</p><form onSubmit={submit}>{mode === 'bootstrap' && <label>Nome completo<input value={name} onChange={e => setName(e.target.value)} placeholder="Seu nome" required minLength={2} /></label>}<label>E-mail<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="nome@empresa.com" required /></label><label>Senha<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo de 8 caracteres" required minLength={8} /></label>{error && <div className="form-error">{error}</div>}{resent && <div className="form-success">E-mail de confirmação reenviado. Confira sua caixa de entrada.</div>}{needsConfirm && <button type="button" className="button button-outline full" style={{ marginBottom: 10 }} onClick={resendConfirmation} disabled={busy}>Reenviar e-mail de confirmação</button>}<button className="button button-primary full" disabled={busy}>{busy ? <><span className="mini-spinner" /> Entrando...</> : mode === 'login' ? 'Entrar na operação' : 'Criar administrador'}</button></form><div className="auth-footer"><span>{mode === 'login' ? 'Primeiro acesso?' : 'Já possui acesso?'}</span><button className="text-button" onClick={() => { setMode(mode === 'login' ? 'bootstrap' : 'login'); setError(''); setNeedsConfirm(false); setResent(false); }}>{mode === 'login' ? 'Configurar administrador' : 'Voltar para login'}</button></div></div><p className="auth-note">Cada funcionário possui um usuário próprio. O acesso é individual e protegido.</p></section></main>;
}

function AppShell({ profile, onLogout, children }: { profile: Profile; onLogout: () => void; children: ReactNode }) {
  const location = useLocation(); const [mobile, setMobile] = useState(false);
  const nav = profile.role === 'admin' ? [{ to: '/vitrine', label: 'Vitrine do catálogo', icon: Building2 }, { to: '/admin', label: 'Visão geral', icon: LayoutDashboard }, { to: '/admin/maquinas', label: 'Máquinas', icon: Package }, { to: '/comparar', label: 'Comparar', icon: Grid2X2 }, { to: '/admin/marcas', label: 'Marcas', icon: Tags }, { to: '/admin/categorias', label: 'Categorias', icon: SlidersHorizontal }, { to: '/admin/usuarios', label: 'Equipe', icon: Users }] : [{ to: '/vitrine', label: 'Vitrine do catálogo', icon: Building2 }, { to: '/catalogo', label: 'Catálogo', icon: Package }, { to: '/comparar', label: 'Comparar máquinas', icon: Grid2X2 }, { to: '/propostas', label: 'Minhas propostas', icon: FileText }];
  return <div className="app-shell"><aside className={mobile ? 'sidebar open' : 'sidebar'}><div className="sidebar-top"><Logo /><button className="mobile-close" onClick={() => setMobile(false)}><X size={20} /></button></div><div className="sidebar-section"><small>NAVEGAÇÃO</small>{nav.map(item => { const Icon = item.icon; const active = location.pathname === item.to || (item.to !== '/admin' && location.pathname.startsWith(item.to)); return <Link key={item.to} to={item.to} className={active ? 'side-link active' : 'side-link'} onClick={() => setMobile(false)}><Icon size={17} />{item.label}<ChevronRight className="side-arrow" size={14} /></Link> })}</div><div className="sidebar-bottom"><Link className="user-mini" to="/perfil" onClick={() => setMobile(false)}><div className="avatar">{profile.full_name.slice(0, 1).toUpperCase()}</div><div><strong>{profile.full_name}</strong><span>{profile.role === 'admin' ? 'Administrador' : 'Vendedor'}</span></div></Link><button className="logout-link" onClick={onLogout}><LogOut size={16} />Sair da conta</button></div></aside><div className="main-frame"><header className="topbar"><button className="mobile-menu" onClick={() => setMobile(true)}><Menu size={20} /></button><div><span className="topbar-kicker">{profile.role === 'admin' ? 'PAINEL ADMINISTRATIVO' : 'OPERAÇÃO COMERCIAL'}</span><strong>{location.pathname.startsWith('/comparar') ? 'Comparar máquinas' : location.pathname.startsWith('/propostas') ? 'Propostas comerciais' : 'Eixo-Catálogo'}</strong></div><div className="topbar-actions"><button className="icon-button"><Bell size={18} /></button><div className="top-avatar">{profile.full_name.slice(0, 1).toUpperCase()}</div></div></header><main className="page-content">{children}</main></div></div>;
}

function PageHeader({ kicker, title, description, action }: { kicker?: string; title: string; description?: string; action?: ReactNode }) { return <div className="page-header"><div><span className="eyebrow gold">{kicker || 'EIXO-CATÁLOGO'}</span><h1>{title}</h1>{description && <p className="muted">{description}</p>}</div>{action}</div>; }
function StatCard({ label, value, detail, icon: Icon, accent = false }: { label: string; value: string | number; detail?: string; icon: typeof Package; accent?: boolean }) { return <div className={accent ? 'stat-card accent' : 'stat-card'}><div className="stat-icon"><Icon size={19} /></div><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>; }
function MachineCard({ machine, onClick, admin = false }: { machine: Machine; onClick: () => void; admin?: boolean }) { return <article className="machine-card"><button className="machine-visual" onClick={onClick}>{machine.image ? <img src={machine.image} alt={machine.display_name} /> : <div className="image-placeholder"><ImageIcon size={26} /><span>FOTO NÃO CADASTRADA</span></div>}<span className={`status-dot ${machine.status}`}>{machine.status === 'available' ? 'DISPONÍVEL' : machine.status === 'negotiating' ? 'EM NEGOCIAÇÃO' : machine.status.toUpperCase()}</span></button><div className="machine-body"><div className="machine-meta"><span>{machine.brand}</span><small>{machine.category}</small></div><h3>{machine.display_name}</h3><div className="price-row"><div><small>VALOR DO BEM</small><strong>{money(machine.value)}</strong></div><div><small>PARCELA A PARTIR DE</small><b>{money(machine.installment)}</b></div></div><div className="machine-tags"><span><Zap size={12} />{machine.power}</span><span><Database size={12} />{machine.hours}</span><span><Building2 size={12} />{machine.location.split(',')[0]}</span></div><button className="button button-outline full" onClick={onClick}>{admin ? 'Editar ficha' : 'Ver ficha completa'} <ChevronRight size={15} /></button></div></article>; }

function Catalog({ machines }: { machines: Machine[] }) { const navigate = useNavigate(); const [query, setQuery] = useState(''); const [category, setCategory] = useState('Todas'); const [brand, setBrand] = useState('Todas'); const categories = [...new Set(machines.map(m => m.category))]; const brands = [...new Set(machines.map(m => m.brand))]; const filtered = machines.filter(m => { const match = `${m.brand} ${m.model} ${m.category} ${m.display_name}`.toLowerCase().includes(query.toLowerCase()); return match && (category === 'Todas' || m.category === category) && (brand === 'Todas' || m.brand === brand); }); const grouped = category === 'Todas' && brand === 'Todas' && !query && categories.length > 1; return <><PageHeader kicker="CATÁLOGO COMERCIAL" title="Máquinas prontas para sua próxima oferta" description="Encontre informações, condições e especificações em poucos segundos." action={<Link to="/comparar" className="button button-dark"><Grid2X2 size={16} /> Comparar máquinas</Link>} /><div className="catalog-toolbar"><div className="search-box"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por marca, modelo, categoria ou código..." /></div><div className="filter-row"><div className="filter-label"><SlidersHorizontal size={15} /> Filtros rápidos</div><button className={category === 'Todas' ? 'chip selected' : 'chip'} onClick={() => setCategory('Todas')}>Todas as categorias</button>{categories.map(item => <button className={category === item ? 'chip selected' : 'chip'} key={item} onClick={() => setCategory(item)}>{item}</button>)}<select value={brand} onChange={e => setBrand(e.target.value)}><option>Todas</option>{brands.map(item => <option key={item}>{item}</option>)}</select></div></div><div className="result-line"><span><strong>{filtered.length}</strong> máquinas encontradas</span>{(query || category !== 'Todas' || brand !== 'Todas') && <button className="text-button" onClick={() => { setQuery(''); setCategory('Todas'); setBrand('Todas'); }}>Limpar filtros</button>}</div>{filtered.length === 0 ? <div className="empty-state"><Package size={34} /><h3>Nenhuma máquina encontrada</h3><p>Ajuste sua busca ou limpe os filtros para ver todo o catálogo.</p></div> : grouped ? <div>{categories.map(cat => <section className="catalog-group" key={cat}><div className="group-heading"><h2>{cat}</h2><span>{filtered.filter(m => m.category === cat).length} opções</span></div><div className="machine-grid">{filtered.filter(m => m.category === cat).map(m => <MachineCard key={m.id} machine={m} onClick={() => navigate(`/maquina/${m.id}`)} />)}</div></section>)}</div> : <div className="machine-grid">{filtered.map(m => <MachineCard key={m.id} machine={m} onClick={() => navigate(`/maquina/${m.id}`)} />)}</div>}</>; }

function MachineDetail({ machines }: { machines: Machine[] }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(false);
  const machine = machines.find(item => item.id === id);
  if (!machine) return <div className="empty-state"><Package size={34} /><h3>Máquina não encontrada</h3><button className="button button-primary" onClick={() => navigate('/catalogo')}>Voltar ao catálogo</button></div>;

  const validPhotos = machine.photos.filter(p => !!p.public_url);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  useEffect(() => { setActiveIndex(0); }, [machine.id]);
  const currentImgUrl: string | undefined = validPhotos[activeIndex]?.public_url ?? machine.image;

  const offer = buildOfferText(machine);
  const copy = async () => { await navigator.clipboard?.writeText(offer); setCopied(true); setTimeout(() => setCopied(false), 1800); };
  return (
    <div className="public-home" style={{ minHeight: '100vh', background: '#f5f2ec' }}>
      <div className="public-container">
        <button className="back-link" onClick={() => navigate(-1)}>← Voltar para catálogo</button>
        <div className="detail-layout">
          <div>
            <div className="detail-gallery">
              <button className="detail-main-image" onClick={() => currentImgUrl && setZoom(true)}>
                {currentImgUrl
                  ? <img src={currentImgUrl} alt={machine.display_name} loading="eager" decoding="async" />
                  : <div className="image-placeholder large"><ImageIcon size={42} /><span>FOTO NÃO CADASTRADA</span></div>}
              </button>
              <div className="thumb-row">
                {validPhotos.length === 0 && (
                  <div className="thumb active">
                    {machine.image ? <img src={machine.image} alt="Miniatura" loading="lazy" decoding="async" /> : <ImageIcon size={16} />}
                  </div>
                )}
                {validPhotos.map((p, i) => (
                  <button
                    type="button"
                    key={`${p.storage_path || ''}-${p.public_url || ''}-${i}`}
                    className={i === activeIndex ? 'thumb active' : 'thumb'}
                    onClick={() => setActiveIndex(i)}
                    title={`Foto ${i + 1}${isPrincipalPhoto(p) ? ' · Principal' : ''}`}
                  >
                    {p.public_url ? <img src={p.public_url} alt={`Miniatura ${i + 1}`} loading="lazy" decoding="async" /> : <ImageIcon size={16} />}
                  </button>
                ))}
              </div>
            </div>
            <div className="detail-copy">
              <span className="eyebrow gold">FICHA TÉCNICA E COMERCIAL</span>
              <div className="detail-title">
                <div>
                  <h1>{machine.display_name}</h1>
                  <p>{machine.brand} · {machine.category} · {machine.year}</p>
                </div>
                <span className="badge"><Check size={13} /> Nova de fábrica</span>
              </div>
              <p className="long-copy">{machine.description || 'Equipamento selecionado para operações de alta produtividade, com excelente desempenho, robustez e suporte especializado.'}</p>
              <div className="quick-stats">
                <div><span>Potência</span><strong>{machine.power}</strong></div>
                <div><span>Peso operacional</span><strong>{machine.weight}</strong></div>
                <div><span>Horímetro</span><strong>{machine.hours}</strong></div>
                <div><span>Localização</span><strong>{machine.location}</strong></div>
              </div>
              <section className="detail-section">
                <h2>Especificações técnicas</h2>
                <div className="spec-grid">
                  {Object.entries(machine.specs).map(([key, value]) => (
                    <div className="spec-item" key={key}>
                      <span>{key}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
              </section>
              <section className="detail-section">
                <h2>Principais aplicações</h2>
                <div className="tag-list">
                  {machine.applications.map(item => <span key={item}>{item}</span>)}
                </div>
              </section>
            </div>
          </div>
          <aside className="offer-card">
            <div className="offer-top">
              <span className="eyebrow gold">CONDIÇÃO COMERCIAL</span>
              <span className="offer-status">Disponível</span>
            </div>
            <h2>Uma oferta pronta para compartilhar</h2>
            <div className="offer-price">
              <small>VALOR TOTAL</small>
              <strong>{money(machine.value)}</strong>
            </div>
            <div className="offer-line"><span>Entrada</span><b>{money(machine.entry)}</b></div>
            <div className="offer-line"><span>Parcela a partir de</span><b>{money(machine.installment)}</b></div>
            <button className={copied ? 'button button-success full' : 'button button-primary full'} onClick={copy}>
              {copied ? <><Check size={16} /> Oferta copiada</> : <><Clipboard size={16} /> Copiar oferta para WhatsApp</>}
            </button>
            <p className="offer-footnote">Os valores refletem as condições cadastradas pela administração.</p>
          </aside>
        </div>
      </div>
      {zoom && currentImgUrl && (
        <div className="modal-backdrop" onClick={() => setZoom(false)}>
          <div className="zoom-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setZoom(false)}><X /></button>
            <img src={currentImgUrl} alt={machine.display_name} loading="eager" decoding="async" />
          </div>
        </div>
      )}
    </div>
  );
}

function Compare({ machines }: { machines: Machine[] }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const choices = machines.filter(m => `${m.brand} ${m.model} ${m.category} ${m.display_name} ${m.location || ''}`.toLowerCase().includes(query.toLowerCase()));
  const current = selected.map(id => machines.find(m => m.id === id)).filter(Boolean) as Machine[];
  const toggle = (id: string) => setSelected(prev => {
    if (prev.includes(id)) return prev.filter(item => item !== id);
    if (prev.length >= 3) return prev;
    return [...prev, id];
  });
  const allSpecs = [...new Set(current.flatMap(m => Object.keys(m.specs)))].sort();
  const slots = 3;
  return (
    <div className="public-home" style={{ minHeight: '100vh', background: '#f5f2ec' }}>
      <div className="public-container">
        <PageHeader
          kicker="DECISÃO COMERCIAL"
          title="Comparar máquinas"
          description="Selecione até 3 máquinas para ver lado a lado preços, entradas, parcelas e especificações."
          action={
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="button button-outline" onClick={() => navigate('/')}>
                <ArrowLeft size={15}/> Voltar ao catálogo
              </button>
              {selected.length > 0 && (
                <button className="button button-outline" onClick={() => setSelected([])}>
                  <X size={16} /> Limpar ({selected.length})
                </button>
              )}
            </div>
          }
        />

      {/* ========== SLOTS SELECIONADOS (fixos = 3 colunas, como se fosse "carrinho") ========== */}
      <div className="compare-slots">
        {Array.from({ length: slots }).map((_, i) => {
          const m = current[i];
          return (
            <div key={i} style={{
              background: m ? '#fff' : '#fbf7ee',
              border: '1px dashed ' + (m ? '#e3dbc5' : '#d6c48a'),
              borderRadius: 16, padding: 16, minHeight: 180,
              display: 'flex', flexDirection: 'column',
              position: 'relative',
              boxShadow: m ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 10,
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 800, letterSpacing: '.12em',
                  color: m ? '#b8963f' : '#a39160',
                }}>SLOT {i + 1}</span>
                {m && (
                  <button
                    title="Remover da comparação"
                    onClick={() => toggle(m.id)}
                    style={{
                      width: 28, height: 28, borderRadius: '50%',
                      border: 'none', background: '#fef2f2', color: '#991b1b',
                      cursor: 'pointer', display: 'grid', placeItems: 'center',
                    }}
                    onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#fee2e2'; }}
                    onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#fef2f2'; }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              {m ? (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{
                    width: 58, height: 58, borderRadius: 12, overflow: 'hidden',
                    background: 'linear-gradient(135deg, #fff4d6 0%, #f4e6b9 100%)',
                    border: '1px solid #ede2c0', flexShrink: 0,
                  }}>
                    {m.photos?.[0]?.public_url || m.image ? (
                      <img src={m.photos?.[0]?.public_url || m.image} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
                        <Package size={22} style={{ color: '#b8963f' }} />
                      </div>
                    )}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.15, color: '#1c1917' }}>
                      {m.display_name}
                    </div>
                    <div style={{ fontSize: 12, color: '#78716c', marginTop: 3 }}>
                      {m.category || ''} · {m.year || ''}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#b8963f', marginTop: 6 }}>
                      {money(m.value)}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{
                  color: '#8b7f65', textAlign: 'center', margin: 'auto 0',
                  display: 'grid', placeItems: 'center', gap: 6,
                }}>
                  <Grid2X2 size={26} style={{ opacity: 0.8 }} />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Vaga {i + 1}</div>
                  <div style={{ fontSize: 11, color: '#a39160' }}>Selecione uma máquina abaixo</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="compare-picker">
        <div className="result-line">
          <strong>{selected.length} de 3 selecionadas</strong>
          <span>Escolha as fichas que deseja comparar</span>
        </div>
        <div className="search-box">
          <Search size={17} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar marca, modelo ou categoria..." />
        </div>
        <div className="choice-list">
          {choices.length === 0 ? (
            <div className="empty-state" style={{ padding: 36 }}>
              <Search size={26} style={{ color: '#b8963f', marginBottom: 6 }} />
              <h3>Nenhuma máquina encontrada</h3>
              <p className="muted">Tente outro termo de busca.</p>
            </div>
          ) : choices.map(m => {
            const isSel = selected.includes(m.id);
            const roomLeft = selected.length < 3;
            const disabled = !isSel && !roomLeft;
            return (
              <button
                key={m.id}
                className={isSel ? 'choice selected' : 'choice'}
                onClick={() => toggle(m.id)}
                disabled={disabled}
                title={disabled ? 'Máximo de 3 selecionadas' : undefined}
                style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
              >
                <span>{m.photos?.[0]?.public_url || m.image ? <img src={m.photos?.[0]?.public_url || m.image} alt="" loading="lazy" decoding="async" /> : <Package size={18} />}</span>
                <div style={{ textAlign: 'left', flex: 1 }}>
                  <strong>{m.display_name}</strong>
                  <small>{m.category} · {money(m.value)}</small>
                </div>
                {isSel && <Check size={16} />}
                {!isSel && !roomLeft && <LockKeyhole size={14} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ========== COMPARAÇÃO ABAIXO (mostra sempre que current.length >= 1 — mesmo 1 só) ========== */}
      {current.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 18 }}>
          <Grid2X2 size={34} />
          <h3>Selecione pelo menos 1 máquina</h3>
          <p>Os cards de comparação aparecem automaticamente aqui. Você pode comparar até 3 lado a lado.</p>
        </div>
      ) : (
        <>
          <div className="comparison-grid" style={{ ['--cmp']: Math.min(current.length, 3) } as CSSProperties}>
            {current.map(m => (
              <article className="comparison-card" key={m.id}>
                <div className="compare-image">
                  {m.photos?.[0]?.public_url || m.image
                    ? <img src={m.photos?.[0]?.public_url || m.image} alt={m.display_name} loading="lazy" decoding="async" />
                    : <ImageIcon size={30} />}
                </div>
                <span className="eyebrow gold">{m.brand || '-'}</span>
                <h2 style={{ fontSize: 20, minHeight: 48 }}>{m.display_name}</h2>
                <small>{m.category || ''}{(m.category && m.year) ? ' · ' : ''}{m.year || ''}</small>
                <div className="compare-prices">
                  <div><span>VALOR</span><strong>{money(m.value)}</strong></div>
                  <div><span>ENTRADA</span><b>{money(m.entry)}</b></div>
                  <div><span>PARCELA</span><b>{money(m.installment)}</b></div>
                </div>
                <div className="compare-specs">
                  {allSpecs.length === 0 && (
                    <div style={{
                      display: 'grid', gap: 8, gridColumn: '1 / -1',
                      fontSize: 13, color: '#57534e',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px dashed #f0e6c8' }}>
                        <span style={{ fontWeight: 600 }}>Localização</span>
                        <strong className={m.location ? '' : 'pending'}>{m.location || 'Em validação'}</strong>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px dashed #f0e6c8' }}>
                        <span style={{ fontWeight: 600 }}>Potência</span>
                        <strong className={m.power ? '' : 'pending'}>{m.power || 'Em validação'}</strong>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px dashed #f0e6c8' }}>
                        <span style={{ fontWeight: 600 }}>Peso operacional</span>
                        <strong className={m.weight ? '' : 'pending'}>{m.weight || 'Em validação'}</strong>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px dashed #f0e6c8' }}>
                        <span style={{ fontWeight: 600 }}>Horas</span>
                        <strong className={m.hours ? '' : 'pending'}>{m.hours || 'Em validação'}</strong>
                      </div>
                    </div>
                  )}
                  {allSpecs.map(spec => (
                    <div key={spec}>
                      <span>{spec}</span>
                      <strong className={m.specs[spec] ? '' : 'pending'}>{m.specs[spec] || 'Em validação'}</strong>
                    </div>
                  ))}
                </div>
                <button
                  className="button button-outline full"
                  onClick={() => navigate(`/maquina/${m.id}`)}
                >
                  Ver detalhes <ChevronRight size={15} />
                </button>
              </article>
            ))}
          </div>
        </>
      )}
      </div>
    </div>
  );
}

function AdminDashboard({ machines }: { machines: Machine[] }) { const navigate = useNavigate(); const pending = machines.reduce((sum, m) => sum + Object.values(m.specs).filter(Boolean).length < 6 ? 1 : 0, 0); const categories = [...new Set(machines.map(m => m.category))]; const brands = [...new Set(machines.map(m => m.brand))]; return <><PageHeader kicker="VISÃO GERAL" title="Bom dia, sua operação está em movimento" description="Acompanhe a saúde do catálogo e os pontos que precisam da sua atenção." action={<button className="button button-primary" onClick={() => navigate('/admin/maquinas/nova')}><Plus size={17} /> Nova máquina</button>} /><div className="stat-grid"><StatCard label="Total de máquinas" value={machines.length} detail="+12% este mês" icon={Package} accent /><StatCard label="Marcas cadastradas" value={brands.length} icon={Tags} /><StatCard label="Categorias usadas" value={categories.length} icon={Grid2X2} /><StatCard label="Fichas completas" value={Math.max(0, machines.length - pending)} detail="de 100% preenchidas" icon={Check} /><StatCard label="Total de fotos" value={machines.filter(m => m.image).length} icon={ImageIcon} /><StatCard label="Sem foto" value={machines.filter(m => !m.image).length} icon={ImageIcon} /></div><div className="dashboard-grid"><section className="panel"><div className="panel-heading"><div><span className="eyebrow gold">ATENÇÃO NECESSÁRIA</span><h2>Qualidade do catálogo</h2></div><span className="pending-number">{pending} pendências</span></div><div className="quality-row"><div className="quality-ring"><strong>{Math.round(((machines.length - pending) / Math.max(machines.length, 1)) * 100)}%</strong><span>completo</span></div><div><h3>Fichas prontas para venda</h3><p className="muted">Revise os campos técnicos para garantir ofertas mais confiáveis.</p><button className="text-button" onClick={() => navigate('/admin/auditoria')}>Abrir auditoria técnica <ChevronRight size={14} /></button></div></div></section><section className="panel"><div className="panel-heading"><div><span className="eyebrow gold">DISTRIBUIÇÃO</span><h2>Máquinas por categoria</h2></div><BarChart3 size={19} /></div>{categories.map(cat => { const count = machines.filter(m => m.category === cat).length; return <button className="bar-row" key={cat} onClick={() => navigate('/admin/maquinas')}><div><span>{cat}</span><b>{count}</b></div><i><em style={{ width: `${(count / machines.length) * 100}%` }} /></i></button> })}</section></div><section className="panel recent-panel"><div className="panel-heading"><div><span className="eyebrow gold">ATIVIDADE</span><h2>Últimos cadastros</h2></div><Link className="text-button" to="/admin/maquinas">Ver todas</Link></div><div className="recent-list">{machines.slice(0, 5).map(m => <button key={m.id} className="recent-item" onClick={() => navigate(`/admin/maquinas/${m.id}`)}><div className="recent-thumb">{m.image ? <img src={m.image} alt="" /> : <Package size={17} />}</div><div><strong>{m.display_name}</strong><small>{m.brand} · {m.category}</small></div><span>{money(m.value)}</span><ChevronRight size={16} /></button>)}</div></section></>; }

function AdminMachines({ machines, setMachines }: { machines: Machine[]; setMachines: (m: Machine[]) => void }) { const navigate = useNavigate(); const [query, setQuery] = useState(''); const filtered = machines.filter(m => `${m.brand} ${m.model} ${m.category}`.toLowerCase().includes(query.toLowerCase())); const [deletingId, setDeletingId] = useState<string | null>(null); const remove = async (id: string) => { if (deletingId) return; if (!window.confirm('Excluir máquina? Ela será removida do catálogo. Esta ação não pode ser desfeita.')) return; setDeletingId(id); try { try { await supabase.from('machine_photos').delete().eq('machine_id', id); } catch { /* ignora */ } try { await supabase.from('machine_images').delete().eq('machine_id', id); } catch { /* ignora */ } const { error } = await supabase.from('machines').delete().eq('id', id); if (error) throw new Error(error.message); setMachines(machines.filter(m => m.id !== id)); } catch (err) { console.error('delete machine error', err); alert('Não foi possível excluir a máquina: ' + (err instanceof Error ? err.message : 'erro desconhecido') + '\n\nVerifique as permissões (RLS) de exclusão na tabela "machines".'); } finally { setDeletingId(null); } }; return <><PageHeader kicker="GESTÃO DO CATÁLOGO" title="Máquinas" description="Cadastre, revise e mantenha as condições comerciais sempre atualizadas." action={<button className="button button-primary" onClick={() => navigate('/admin/maquinas/nova')}><Plus size={17} /> Nova máquina</button>} /><div className="list-toolbar"><div className="search-box"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por marca, modelo ou categoria..." /></div><span>{filtered.length} registros</span></div><div className="table-panel"><div className="data-table head"><span>Máquina</span><span>Categoria</span><span>Status</span><span>Valor</span><span>Atualizado</span><span /></div>{filtered.map(m => <div className="data-table" key={m.id}><div className="table-machine"><div className="table-thumb">{m.image ? <img src={m.image} alt="" /> : <Package size={16} />}</div><div><strong>{m.display_name}</strong><small>{m.brand} · {m.model}</small></div></div><span>{m.category}</span><span><i className={`table-status ${m.status}`} />{m.status === 'available' ? 'Disponível' : 'Em negociação'}</span><strong>{money(m.value)}</strong><span>{date(new Date())}</span><div className="row-actions"><button onClick={() => navigate(`/maquina/${m.id}`)} title="Ver"><ChevronRight size={16} /></button><button onClick={() => navigate(`/admin/maquinas/${m.id}`)} title="Editar"><Settings size={16} /></button><button onClick={() => remove(m.id)} title="Excluir" disabled={deletingId === m.id}><Trash2 size={16} /></button></div></div>)}</div></>; }

function MachineForm({ machines, setMachines }: { machines: Machine[]; setMachines: (m: Machine[]) => void }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const existing = machines.find(m => m.id === id);

  const [categoriesList, setCategoriesList] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    (async () => {
      try {
        const r = await supabase.from('categories').select('id,name').eq('is_visible', true).order('name');
        if (r.data) setCategoriesList(r.data as Array<{ id: string; name: string }>);
      } catch { /* ignore */ }
    })();
  }, []);

  type BrandRow = { id: string; name: string; is_active: boolean };
  const [brandsList, setBrandsList] = useState<BrandRow[]>([]);
  const [brandErr, setBrandErr] = useState<string | null>(null);
  const [createBrandOpen, setCreateBrandOpen] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [createBrandBusy, setCreateBrandBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      setBrandErr(null);
      try {
        const r = await supabase.from('brands').select('id,name,is_active').eq('is_active', true).order('name');
        if (r.error) throw new Error(r.error.message || String(r.error));
        if (r.data && alive) {
          const list = r.data as BrandRow[];
          setBrandsList(list);
          // ===== DINÂMICO: se é NOVA máquina (sem existing) e ainda não tem brand selecionado
          //   seleciona AUTOMATICAMENTE a 1ª marca cadastrada.
          if (!existing && list.length > 0) {
            setForm(prevForm => {
              if (!prevForm.brand || prevForm.brand.trim().length === 0) {
                return { ...prevForm, brand: list[0].name };
              }
              return prevForm;
            });
          }
        }
      } catch (e) {
        if (!alive) return;
        setBrandErr(e instanceof Error ? e.message : String(e));
        // Fallback: extrai marcas das próprias máquinas para o select mesmo sem tabela brands
        const seen = new Set<string>();
        const fb: BrandRow[] = [];
        for (const m of machines) {
          if (!m.brand || m.brand.trim().length < 2) continue;
          const n = m.brand.trim().toUpperCase();
          if (seen.has(n)) continue;
          seen.add(n);
          fb.push({ id: `fb-${n}`, name: n, is_active: true });
        }
        fb.sort((a, b) => a.name.localeCompare(b.name));
        setBrandsList(fb);
        if (!existing && fb.length > 0) {
          setForm(prevForm => !prevForm.brand ? { ...prevForm, brand: fb[0].name } : prevForm);
        }
      }
    })();
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id]);

  const refreshBrands = async () => {
    try {
      const r = await supabase.from('brands').select('id,name,is_active').eq('is_active', true).order('name');
      if (r.data) { setBrandsList(r.data as BrandRow[]); setBrandErr(null); }
    } catch { /* ignore */ }
  };

  const saveNewBrandInline = async () => {
    const next = newBrandName.trim().toUpperCase();
    if (next.length < 2) return;
    if (brandsList.some(b => b.name.toUpperCase() === next)) {
      setForm(p => ({ ...p, brand: next }));
      setCreateBrandOpen(false);
      setNewBrandName('');
      return;
    }
    setCreateBrandBusy(true);
    try {
      const slug = next.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const r = await supabase.from('brands').insert([{ name: next, slug, accent_color: '#B8963F', is_active: true }]).select('id,name,is_active').maybeSingle();
      if (r.error) throw new Error(r.error.message || String(r.error));
      setForm(p => ({ ...p, brand: next }));
      setCreateBrandOpen(false);
      setNewBrandName('');
      await refreshBrands();
    } catch (e) {
      setBrandErr(e instanceof Error ? e.message : String(e));
      // fallback: escreve direto como texto (compat)
      setForm(p => ({ ...p, brand: next }));
      setCreateBrandOpen(false);
      setNewBrandName('');
    } finally {
      setCreateBrandBusy(false);
    }
  };

  const defaultCat = categoriesList[0]?.name || existing?.category || 'ESCAVADEIRA';
  const defaultBrand = existing?.brand ? existing.brand : (brandsList[0]?.name || '');
  const [form, setForm] = useState<Machine>(
    existing
      ? { ...existing, description: existing.description ?? '', notes: existing.notes ?? '' }
      : {
          id: `m${Date.now()}`, internal_code: '',
          brand: defaultBrand, model: '', display_name: '',
          category: defaultCat, value: 0, entry: 0, installment: 0,
          year: new Date().getFullYear(), status: 'available', power: '', weight: '', hours: '',
          location: '', description: '', notes: '', applications: [], specs: {}, photos: [],
        }
  );
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [currentPhotos, setCurrentPhotos] = useState<PendingPhoto[]>([]);

  const loadExistingPhotos = async (machineId: string) => {
    const accum: PendingPhoto[] = [];
    try {
      const pr = await supabase
        .from('machine_photos')
        .select('id,machine_id,storage_path,public_url,is_primary,photo_type')
        .eq('machine_id', machineId);
      if (pr.data && pr.data.length > 0) {
      for (const p of pr.data as Array<PendingPhoto>) {
        accum.push({
          tempId: `mp-${p.id || Math.random()}`,
          preview: p.public_url ?? '',
          id: p.id,
          machine_id: p.machine_id,
          storage_path: p.storage_path,
          source: 'machine_photos',
          is_primary: p.is_primary,
          photo_type: p.photo_type,
          public_url: p.public_url,
        });
      }
    }
    } catch (err) {
      console.warn('machine_photos load falhou', err);
    }
    if (accum.length === 0) {
      try {
        const ir = await supabase
          .from('machine_images')
          .select('id,machine_id,storage_path,public_url,photo_type')
          .eq('machine_id', machineId);
        if (ir.data && ir.data.length > 0) {
          for (const p of ir.data as Array<PendingPhoto & { photo_type?: string }>) {
            accum.push({
              tempId: `mi-${p.id || Math.random()}`,
              preview: p.public_url ?? '',
              id: p.id,
              machine_id: p.machine_id,
              storage_path: p.storage_path,
              source: 'machine_images',
              photo_type: p.photo_type,
              public_url: p.public_url,
              is_primary: typeof p.photo_type === 'string' && p.photo_type.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === 'principal',
            });
          }
        }
      } catch (err) {
        console.warn('machine_images load falhou', err);
      }
    }
    setCurrentPhotos(accum);
  };

  useEffect(() => { if (existing?.id) loadExistingPhotos(existing.id); }, [existing?.id]);

  type UploadOutcome = { status: 'ok'; photo: PendingPhoto } | { status: 'storage_only'; photo: PendingPhoto; warning: string } | { status: 'error'; message: string };

  const COLS_UNIVERSAIS_FOTO = ['machine_id','storage_path','public_url','photo_type'] as const;
  type UniversalPhoto = { machine_id: string; storage_path: string; public_url: string | null; photo_type: string };

  const tryInsert = async (table: 'machine_photos' | 'machine_images', payload: Record<string, unknown>): Promise<{ id?: string; error: string | null }> => {
    try {
      const { data, error } = await supabase.from(table).insert(payload).select('id').maybeSingle();
      if (error) return { error: error.message || String(error) };
      const id = data && (data as Record<string, unknown>).id ? (data as Record<string, unknown>).id as string : undefined;
      return { id, error: null };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  };

  const uploadSingle = async (machineId: string, file: File): Promise<UploadOutcome> => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return { status: 'error', message: 'Formato não suportado. Use JPG, PNG ou WebP.' };
    if (file.size > 10 * 1024 * 1024) return { status: 'error', message: 'Um arquivo excede 10 MB.' };
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
    const path = `${machineId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from('machine-photos')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) return { status: 'error', message: `Erro no Storage: ${uploadError.message || uploadError.toString()}` };
    let publicUrl: string | null = null;
    try {
      const { data: pub } = supabase.storage.from('machine-photos').getPublicUrl(path);
      if (pub?.publicUrl) publicUrl = pub.publicUrl;
    } catch { /* ignore */ }
    const basePhoto: PendingPhoto = {
      tempId: `new-${Date.now()}-${Math.random()}`,
      preview: publicUrl || URL.createObjectURL(file),
      public_url: publicUrl ?? undefined,
      machine_id: machineId,
      storage_path: path,
      photo_type: 'other',
      is_primary: false,
    };
    // payload PADRÃO = TODAS as colunas NOT NULL (id, machine_id, storage_path, photo_type, is_primary, created_at)
    // usando sempre valores explícitos para NÃO DEPENDER de DEFAULT da tabela
    const completePayload = {
      machine_id: machineId,
      storage_path: path,
      public_url: publicUrl,
      photo_type: 'other',
      is_primary: false,
      created_at: new Date().toISOString(),
    } as Record<string, unknown>;
    const universalNoCreatedNoIsPrimary = {
      machine_id: machineId,
      storage_path: path,
      public_url: publicUrl,
      photo_type: 'other',
    };
    const errors: Array<{ table: string; msg: string }> = [];
    let source: 'machine_photos' | 'machine_images' | undefined;
    let insertedId: string | undefined;
    // ------------------------------------------------------------------
    // TENTATIVA 1: machine_photos com payload COMPLETO
    //   (id omitido — se a tabela tiver DEFAULT gen_random_uuid() no id, funciona;
    //    caso contrário vai cair no erro e na próxima tentativa enviamos id explícito)
    // ------------------------------------------------------------------
    const mpFullR = await tryInsert('machine_photos', completePayload);
    if (!mpFullR.error && mpFullR.id) { source = 'machine_photos'; insertedId = mpFullR.id; }
    else {
      if (mpFullR.error) { errors.push({ table: 'machine_photos(payload completo)', msg: mpFullR.error }); console.warn('[upload] mpFull:', mpFullR.error); }
      // ------------------------------------------------------------------
      // TENTATIVA 2: machine_photos com ID EXPLÍCITO (UUID gerado no client)
      //   se o erro da tentativa 1 foi "null value in column \"id\" violates not-null"
      //   ou se a tabela não tem default gen_random_uuid() no id
      // ------------------------------------------------------------------
      try {
        const explicitIdPayload = { ...completePayload, id: crypto.randomUUID() } as Record<string, unknown>;
        const mpExplicitId = await tryInsert('machine_photos', explicitIdPayload);
        if (!mpExplicitId.error && mpExplicitId.id) { source = 'machine_photos'; insertedId = mpExplicitId.id; }
        else if (mpExplicitId.error) { errors.push({ table: 'machine_photos(id explícito)', msg: mpExplicitId.error }); console.warn('[upload] mpExplicitId:', mpExplicitId.error); }
      } catch (e) { errors.push({ table: 'machine_photos(id explícito/catch)', msg: e instanceof Error ? e.message : String(e) }); }
      // ------------------------------------------------------------------
      // TENTATIVA 3: machine_images com payload UNIVERSAL (só colunas que existem SEMPRE)
      //   id omitido — a sua tabela machine_images já tem DEFAULT gen_random_uuid()
      //   porque as fotos antigas do invest-catalog funcionam
      // ------------------------------------------------------------------
      if (!source) {
        const miShort = await tryInsert('machine_images', universalNoCreatedNoIsPrimary as unknown as Record<string, unknown>);
        if (!miShort.error && miShort.id) { source = 'machine_images'; insertedId = miShort.id; }
        else if (miShort.error) { errors.push({ table: 'machine_images(4 colunas)', msg: miShort.error }); console.warn('[upload] miShort:', miShort.error); }
        // ------------------------------------------------------------------
        // TENTATIVA 4: machine_images com ID EXPLÍCITO (fallback final)
        // ------------------------------------------------------------------
        if (!source) {
          try {
            const miExplicit = {
              ...universalNoCreatedNoIsPrimary, id: crypto.randomUUID(),
            } as unknown as Record<string, unknown>;
            const miE = await tryInsert('machine_images', miExplicit);
            if (!miE.error && miE.id) { source = 'machine_images'; insertedId = miE.id; }
            else if (miE.error) { errors.push({ table: 'machine_images(id explícito)', msg: miE.error }); console.warn('[upload] miExplicit:', miE.error); }
          } catch (e) { errors.push({ table: 'machine_images(id explicit/catch)', msg: e instanceof Error ? e.message : String(e) }); }
        }
      }
    }
    const photo: PendingPhoto = { ...basePhoto, id: insertedId, source };
    if (!source) {
      const warning = errors.map(e => `• [${e.table}] ${e.msg}`).join('\n');
      return { status: 'storage_only', photo, warning };
    }
    return { status: 'ok', photo };
  };

  const onFilesSelected = async (files: FileList | null) => {
    if (!files) return;
    setUploadMessage('');
    const incoming: PendingPhoto[] = [];
    for (const f of Array.from(files)) {
      incoming.push({
        tempId: `p-${Date.now()}-${Math.random()}`,
        preview: URL.createObjectURL(f),
        file: f,
      });
    }
    const hasInvalid = incoming.some(p => p.file && !['image/jpeg','image/png','image/webp'].includes(p.file!.type));
    if (hasInvalid) { setUploadMessage('❌ Formato não suportado. Use JPG, PNG ou WebP.'); return; }
    const tooBig = incoming.find(p => p.file && p.file!.size > 10 * 1024 * 1024);
    if (tooBig) { setUploadMessage('❌ Um arquivo excede 10 MB.'); return; }
    setCurrentPhotos(prev => [...prev, ...incoming]);
    if (existing) {
      setUploading(true);
      try {
        const uploads: Array<Promise<UploadOutcome>> = [];
        for (const p of incoming) {
          if (!p.file) continue;
          uploads.push(uploadSingle(existing.id, p.file));
        }
        const results = await Promise.all(uploads);
        let storageOnlyCount = 0;
        let okCount = 0;
        let errorMsgs: string[] = [];
        const warningsAgg: string[] = [];
        const mergedResults = new Map<string, UploadOutcome>();
        incoming.forEach((p, i) => { if (results[i]) mergedResults.set(p.tempId, results[i]); });
        for (let i = 0; i < incoming.length; i++) {
          const out = results[i]; if (!out) continue;
          if (out.status === 'ok') okCount++;
          else if (out.status === 'storage_only') { storageOnlyCount++; if (out.warning) warningsAgg.push(out.warning); }
          else errorMsgs.push(out.message);
        }
        setCurrentPhotos(prev => prev.map(p => {
          if (!p.file) return p;
          const out = mergedResults.get(p.tempId);
          if (out && (out.status === 'ok' || out.status === 'storage_only')) {
            if (p.preview.startsWith('blob:')) URL.revokeObjectURL(p.preview);
            return out.photo;
          }
          return p;
        }));
        const totalGravadas = okCount + storageOnlyCount;
        if (okCount === incoming.length && okCount > 0) {
          setUploadMessage(`✅ ${okCount} foto${okCount===1?'':'s'} enviada${okCount===1?'':'s'} com sucesso!`);
        } else if (totalGravadas > 0 || warningsAgg.length > 0) {
          const uniqueLines = Array.from(new Set(
            warningsAgg.join('\n').split('\n').filter(Boolean)
          ));
          const bullet = uniqueLines.length > 0 ? `\n\n🛠  Erros específicos (por tabela):\n${uniqueLines.slice(0, 8).join('\n')}${uniqueLines.length > 8 ? `\n...(+${uniqueLines.length - 8} mais, ver F12 > Console)` : ''}\n` : '';
          const fixo = storageOnlyCount === 0 ? '' : `⚠ ${storageOnlyCount} foto${storageOnlyCount===1?'':'s'} salva${storageOnlyCount===1?'':'s'} no Storage (aparece na prévia), mas NÃO gravou${storageOnlyCount===1?'':''} registro no banco.\n\n🕵  Como corrigir (30 segundos): No SQL Editor rode:\n\n    ALTER TABLE public.machine_images ENABLE ROW LEVEL SECURITY;\n    DROP POLICY IF EXISTS images_insert ON public.machine_images;\n    CREATE POLICY images_insert ON public.machine_images FOR INSERT TO authenticated WITH CHECK (true);\n\n    CREATE TABLE IF NOT EXISTS public.machine_photos (LIKE public.machine_images INCLUDING ALL);\n    ALTER TABLE public.machine_photos ENABLE ROW LEVEL SECURITY;\n    DROP POLICY IF EXISTS photos_insert ON public.machine_photos;\n    CREATE POLICY photos_insert ON public.machine_photos FOR INSERT TO authenticated WITH CHECK (true);\n    DROP POLICY IF EXISTS photos_update ON public.machine_photos;\n    CREATE POLICY photos_update ON public.machine_photos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);\n    DROP POLICY IF EXISTS photos_delete ON public.machine_photos;\n    CREATE POLICY photos_delete ON public.machine_photos FOR DELETE TO authenticated USING (true);\n`;
          setUploadMessage(fixo + bullet);
        } else {
          setUploadMessage('❌ ' + (errorMsgs[0] || 'Não foi possível enviar as fotos.'));
        }
      } catch (cause) {
        console.error(cause);
        setUploadMessage('❌ Não foi possível enviar as fotos: ' + (cause instanceof Error ? cause.message : ''));
      } finally {
        setUploading(false);
      }
    } else {
      setUploadMessage('✅ Fotos anexadas. Serão enviadas ao salvar a máquina.');
    }
  };

  const removePhoto = async (tempId: string) => {
    const target = currentPhotos.find(p => p.tempId === tempId);
    if (!target) return;
    if (target.preview.startsWith('blob:')) URL.revokeObjectURL(target.preview);
    // Se tem storage_path (já foi enviada para storage), tenta apagar fisicamente:
    if (target.storage_path && (target.source === 'machine_photos' || target.source === 'machine_images')) {
      try { await supabase.storage.from('machine-photos').remove([target.storage_path]); }
      catch (err) { console.warn('storage remove falhou', err); }
    }
    if (target.id && target.source) {
      try { await supabase.from(target.source).delete().eq('id', target.id); }
      catch (err) { console.warn('db delete falhou', err); }
    }
    setCurrentPhotos(prev => prev.filter(p => p.tempId !== tempId));
  };

  const setAsPrimary = async (tempId: string) => {
    setCurrentPhotos(prev => {
      const out: PendingPhoto[] = prev.map(p => {
        const next = { ...p, is_primary: p.tempId === tempId };
        if (next.photo_type && (next.source === 'machine_images' || !next.source)) next.photo_type = next.is_primary ? 'Principal' : 'Lateral';
        return next;
      });
      return out;
    });
    const target = currentPhotos.find(p => p.tempId === tempId);
    if (!target || !target.id || !target.source) return;
    if (target.source === 'machine_photos') {
      try { await supabase.from('machine_photos').update({ is_primary: true }).eq('id', target.id); await supabase.from('machine_photos').update({ is_primary: false }).neq('id', target.id).eq('machine_id', target.machine_id!); } catch (err) { console.warn(err); }
    } else {
      try { await supabase.from('machine_images').update({ photo_type: 'Principal' }).eq('id', target.id); await supabase.from('machine_images').update({ photo_type: 'Lateral' }).neq('id', target.id).eq('machine_id', target.machine_id!); } catch (err) { console.warn(err); }
    }
  };

  const field = (key: keyof Machine, value: string | number) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return; // evita duplo clique gerar cadastros duplicados
    if (!form.brand || !form.model) {
      setUploadMessage('❌ Preencha a marca e o modelo antes de salvar.');
      return;
    }
    setUploadMessage('');
    setSaving(true);
    try {
    const normalized: Machine = {
      ...form,
      display_name: form.display_name.trim().replace(/\s+/g, ' ') || `${form.brand} ${form.model}`,
    };
    const matchedCategory = categoriesList.find(c => c.name.toUpperCase() === (form.category || '').toUpperCase());
    const payload = {
      brand: normalized.brand.toUpperCase(),
      model: normalized.model,
      display_name: normalized.display_name,
      category: (form.category || '').toUpperCase(),
      category_id: matchedCategory?.id ?? null,
      internal_code: normalized.internal_code ?? null,
      code: normalized.internal_code ?? null,
      value: Number(normalized.value || 0),
      price: Number(normalized.value || 0),
      down_payment: Number(normalized.entry || 0),
      installment: Number(normalized.installment || 0),
      manufacture_year: normalized.year ? Number(normalized.year) : null,
      year: normalized.year ? Number(normalized.year) : null,
      power: normalized.power || null,
      operating_weight: normalized.weight || null,
      hours: normalized.hours || null,
      location: normalized.location || null,
      status: normalized.status,
      description: normalized.description || null,
      notes: normalized.notes || null,
      specs: normalized.specs,
      applications: normalized.applications,
    };
    let machineIdForPhotos = existing?.id;
    if (existing) {
      const { error } = await supabase.from('machines').update(payload).eq('id', existing.id);
      if (error) {
        console.error('update error', error);
        setUploadMessage('❌ Não foi possível salvar a máquina: ' + error.message);
        return;
      }
    } else {
      const { data: inserted, error } = await supabase
        .from('machines')
        .insert([payload])
        .select('*')
        .maybeSingle();
      if (error || !inserted) {
        console.error('insert error', error);
        setUploadMessage('❌ Não foi possível salvar a máquina: ' + (error?.message || 'o banco não retornou o novo registro.'));
        return;
      }
      normalized.id = String((inserted as Record<string, unknown>).id);
      normalized.category_id = (inserted as Record<string, unknown>).category_id as string | undefined;
      machineIdForPhotos = normalized.id;
      // Upload de fotos pendentes (anexadas antes do save na criação)
      const pending = currentPhotos.filter(p => !!p.file);
      if (pending.length > 0 && machineIdForPhotos) {
        setUploading(true);
        setUploadMessage('⏳ Enviando fotos anexadas...');
        try {
          const results = await Promise.all(pending.map(p => uploadSingle(machineIdForPhotos!, p.file!)));
          let okCount = 0, storageOnlyCount = 0;
          const errorMsgs: string[] = [];
          const mergeMap = new Map<string, UploadOutcome>();
          pending.forEach((p, i) => { if (results[i]) mergeMap.set(p.tempId, results[i]); });
          for (const out of results) {
            if (out.status === 'ok') okCount++;
            else if (out.status === 'storage_only') storageOnlyCount++;
            else errorMsgs.push(out.message);
          }
          setCurrentPhotos(prev => prev.map(p => {
            if (!p.file) return p;
            const out = mergeMap.get(p.tempId);
            if (out && (out.status === 'ok' || out.status === 'storage_only')) {
              if (p.preview.startsWith('blob:')) URL.revokeObjectURL(p.preview);
              return out.photo;
            }
            return p;
          }));
          const totalOk = okCount + storageOnlyCount;
          if (errorMsgs.length === 0) {
            setUploadMessage(storageOnlyCount === 0
              ? `✅ Máquina salva e ${okCount} foto${okCount===1?'':'s'} enviada${okCount===1?'':'s'}!`
              : `⚠ ${totalOk} foto${totalOk===1?'':'s'} salva${totalOk===1?'':'s'} no Storage, mas ${storageOnlyCount} registro${storageOnlyCount===1?'':'s'} no banco falhou. Aplique a RLS Policy INSERT na(s) tabela(s) machine_photos/machine_images (instruções abaixo).`
            );
          } else {
            setUploadMessage('⚠ ' + (storageOnlyCount > 0
              ? `${totalOk} foto${totalOk===1?'s':''} salva${totalOk===1?'s':''} no Storage. ` : '') + 'Falha de banco: ' + errorMsgs[0] + ' Rode a RLS Policy INSERT (instruções abaixo).');
          }
        } catch (cause) {
          console.error(cause);
          setUploadMessage('❌ Máquina salva, mas erro no envio: ' + (cause instanceof Error ? cause.message : ''));
        } finally {
          setUploading(false);
        }
      }
    }
    // Atualiza a imagem principal do normalized com base em currentPhotos (após uploads)
    setTimeout(() => {
      const main = currentPhotos.find(p => isPrincipalPhoto({
        is_primary: p.is_primary, is_main: false, photo_type: p.photo_type, public_url: p.public_url,
      })) || currentPhotos[0];
      const image = main?.preview || main?.public_url || normalized.image;
      const existingIndex = machines.findIndex(m => m.id === normalized.id);
      let next: Machine[];
      if (existingIndex >= 0) {
        next = machines.slice();
        next[existingIndex] = { ...normalized, image };
      } else {
        next = [{ ...normalized, image }, ...machines];
      }
      setMachines(next);
    }, 0);
    setMachines(existing ? machines.map(m => (m.id === existing.id ? normalized : m)) : [normalized, ...machines]);
    setSaved(true);
    // Após salvar, volta para a listagem: a próxima edição passa a carregar a máquina existente,
    // então "Salvar" ATUALIZA o registro em vez de criar cadastros duplicados.
    navigate('/admin/maquinas');
    } catch (cause) {
      console.error('save machine error', cause);
      setUploadMessage('❌ Não foi possível salvar a máquina: ' + (cause instanceof Error ? cause.message : 'erro inesperado.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button className="back-link" onClick={() => navigate('/admin/maquinas')}>← Voltar para máquinas</button>
      <PageHeader
        kicker={existing ? 'EDIÇÃO DE FICHA' : 'NOVO CADASTRO'}
        title={existing ? existing.display_name : 'Cadastrar máquina'}
        description="Preencha as informações comerciais, técnicas e de apresentação da ficha."
      />
      <form className="form-layout" onSubmit={save}>
        <div className="form-main">
          <section className="form-card">
            <div className="form-card-heading">
              <div>
                <span className="eyebrow gold">01 · BASE COMERCIAL</span>
                <h2>Dados da máquina</h2>
              </div>
              <Package size={20} />
            </div>
            <div className="form-grid">
              <label>Código interno
                <input
                  value={existing ? (existing.internal_code ?? '') : (form.internal_code ?? '')}
                  onChange={e => setForm(p => ({ ...p, internal_code: e.target.value }))}
                  placeholder="Ex: EQ-0024"
                />
              </label>
              <label>Categoria
                <select value={form.category} onChange={e => field('category', e.target.value)} required>
                  {categoriesList.length === 0 && <option value="">Carregando...</option>}
                  {categoriesList.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  {!categoriesList.find(c => c.name.toUpperCase() === (form.category || '').toUpperCase()) &&
                    form.category && <option value={form.category}>{form.category}</option>}
                </select>
              </label>
              <label>Marca *
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    {brandsList.length === 0 || brandErr ? (
                      // Fallback para input text caso a tabela brands ainda não exista / RLS bloqueie
                      <input
                        value={form.brand}
                        onChange={e => field('brand', e.target.value.toUpperCase())}
                        required
                        placeholder={brandErr ? 'Digite a marca (tabela brands indisponível)' : 'Carregando marcas... digite aqui'}
                      />
                    ) : (
                      <select
                        value={form.brand}
                        onChange={e => field('brand', e.target.value)}
                        required
                      >
                        <option value="">Selecione uma marca</option>
                        {brandsList.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                        {/* Se a marca já existente na ficha não estiver na lista ativa, exibe como opção para não apagar dados */}
                        {form.brand && !brandsList.some(b => b.name.toUpperCase() === (form.brand || '').toUpperCase()) && (
                          <option value={form.brand}>{form.brand} <span style={{ color: '#a8a29e' }}>(marca atual)</span></option>
                        )}
                      </select>
                    )}
                  </div>
                  {!brandErr && (
                    <button
                      type="button"
                      onClick={() => setCreateBrandOpen(o => !o)}
                      title="Cadastrar nova marca"
                      className="button button-outline"
                      style={{
                        padding: '10px 12px', alignSelf: 'stretch',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {createBrandOpen ? <X size={16} /> : <Plus size={16} />}
                      <span style={{ marginLeft: 4 }}>{createBrandOpen ? 'Fechar' : 'Nova'}</span>
                    </button>
                  )}
                </div>
                {createBrandOpen && !brandErr && (
                  <div style={{
                    marginTop: 10, padding: 14, border: '1px dashed #e0c97a',
                    borderRadius: 14, background: '#fefbf0',
                  }}>
                    <div style={{
                      fontSize: 12, fontWeight: 800, letterSpacing: '.1em', color: '#b8963f',
                      marginBottom: 8,
                    }}>
                      + NOVA MARCA (será cadastrada e selecionada automaticamente)
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div className="search-box" style={{ flex: 1 }}>
                        <Tags size={15} />
                        <input
                          autoFocus
                          value={newBrandName}
                          onChange={e => setNewBrandName(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), saveNewBrandInline())}
                          placeholder="Nome da marca (ex: SANY)"
                        />
                      </div>
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={saveNewBrandInline}
                        disabled={createBrandBusy || newBrandName.trim().length < 2}
                      >
                        {createBrandBusy ? 'Salvando...' : <><Save size={15}/> Salvar</>}
                      </button>
                    </div>
                    {brandErr && (
                      <p className="muted" style={{ marginTop: 8, color: '#b45309', fontSize: 12 }}>
                        Aviso: {brandErr}. A marca será usada no cadastro desta máquina, mas rodar a migration de brands é recomendado para ela aparecer em outras telas.
                      </p>
                    )}
                  </div>
                )}
              </label>
              <label>Modelo *
                <input value={form.model} onChange={e => field('model', e.target.value)} required placeholder="Ex: EC140" />
              </label>
              <label className="span-2">Nome oficial exibido
                <input value={form.display_name} onChange={e => field('display_name', e.target.value)} placeholder="Preenchido automaticamente se vazio" />
              </label>
              <label>Valor do bem
                <input type="number" value={form.value || ''} onChange={e => field('value', Number(e.target.value))} />
              </label>
              <label>Entrada
                <input type="number" value={form.entry || ''} onChange={e => field('entry', Number(e.target.value))} />
              </label>
              <label>Parcela a partir de
                <input type="number" value={form.installment || ''} onChange={e => field('installment', Number(e.target.value))} />
              </label>
              <label>Ano de fabricação
                <input type="number" value={form.year || ''} onChange={e => field('year', Number(e.target.value))} />
              </label>
              <label>Potência
                <input value={form.power} onChange={e => field('power', e.target.value)} placeholder="Ex: 145 HP" />
              </label>
              <label>Peso operacional
                <input value={form.weight} onChange={e => field('weight', e.target.value)} placeholder="Ex: 22.000 kg" />
              </label>
              <label>Horas de uso
                <input value={form.hours} onChange={e => field('hours', e.target.value)} placeholder="Ex: 2.840 h" />
              </label>
              <label>Localização
                <input value={form.location} onChange={e => field('location', e.target.value)} placeholder="Cidade, UF" />
              </label>
              <label>Status
                <select value={form.status} onChange={e => field('status', e.target.value)}>
                  <option value="available">DISPONÍVEL</option>
                  <option value="negotiating">EM NEGOCIAÇÃO</option>
                  <option value="sold">VENDIDA</option>
                  <option value="unavailable">INDISPONÍVEL</option>
                </select>
              </label>
              <label className="span-2">Descrição
                <textarea value={form.description || ''} onChange={e => field('description', e.target.value)} maxLength={2000} rows={4} placeholder="Apresente os principais diferenciais desta máquina..." />
              </label>
            </div>
          </section>
          <section className="form-card">
            <div className="form-card-heading">
              <div>
                <span className="eyebrow gold">02 · VALIDAÇÃO</span>
                <h2>Especificações técnicas</h2>
              </div>
              <ShieldCheck size={20} />
            </div>
            <div className="validation-note"><ShieldCheck size={17} /><span>Marque os dados já conferidos em uma fonte técnica oficial.</span></div>
            <div className="spec-edit-grid">
              {['Profundidade máxima', 'Capacidade da caçamba', 'Alcance máximo', 'Motor', 'Transmissão', 'Vazão hidráulica'].map(label => (
                <label key={label}>
                  {label}
                  <input
                    value={form.specs[label] || ''}
                    onChange={e => setForm(prev => ({ ...prev, specs: { ...prev.specs, [label]: e.target.value } }))}
                    placeholder="Em validação"
                  />
                </label>
              ))}
            </div>
          </section>
        </div>
        <aside className="form-aside">
          <section className="form-card save-card">
            <span className="eyebrow gold">PUBLICAÇÃO</span>
            <h2>Pronto para salvar?</h2>
            <p className="muted">A ficha ficará disponível para a equipe assim que for salva.</p>
            <button className="button button-primary full" type="submit" disabled={saving}>
              {saving ? <><span className="mini-spinner" /> Salvando...</> : saved ? <><Check size={16} /> Máquina salva</> : 'Salvar máquina'}
            </button>
            <button type="button" className="button button-outline full" onClick={() => navigate('/admin/maquinas')}>Cancelar</button>
          </section>
          <section className="form-card photo-card">
            <ImageIcon size={22} />
            <h3>Fotos reais</h3>
            <p className="muted">
              {existing
                ? 'Imagens privadas no bucket machine-photos. Clique em uma miniatura para marcá-la como principal.'
                : 'Anexe as fotos antes de salvar — elas serão enviadas automaticamente junto com o cadastro.'}
            </p>
            <label className="photo-upload">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={e => onFilesSelected(e.target.files)}
                disabled={uploading}
              />
              <span className="button button-outline full">
                {uploading ? 'Enviando fotos...' : currentPhotos.length > 0 ? 'Adicionar mais fotos' : 'Selecionar fotos'}
              </span>
            </label>
            {uploadMessage && (
              <div style={{
                marginTop: 10,
                padding: '10px 12px',
                borderRadius: 10,
                fontSize: 13,
                lineHeight: 1.45,
                background:
                  uploadMessage.startsWith('❌') ? '#fef2f2' :
                  uploadMessage.startsWith('⚠') ? '#fffbeb' :
                  '#ecfdf5',
                color:
                  uploadMessage.startsWith('❌') ? '#991b1b' :
                  uploadMessage.startsWith('⚠') ? '#92400e' :
                  '#065f46',
                border: '1px solid ' + (
                  uploadMessage.startsWith('❌') ? '#fecaca' :
                  uploadMessage.startsWith('⚠') ? '#fde68a' :
                  '#a7f3d0'
                ),
              }}>{uploadMessage}</div>
            )}
            {currentPhotos.length > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                  <small className="muted">{currentPhotos.length} foto{currentPhotos.length === 1 ? '' : 's'} anexada{currentPhotos.length === 1 ? '' : 's'}</small>
                  {currentPhotos.some(p => !p.is_primary && !p.preview.includes('blob:') ? false : false) && <span />}
                </div>
                <div
                  aria-label="Fotos anexadas"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    gap: 10,
                    marginTop: 8,
                  }}
                >
                  {currentPhotos.map(p => {
                    const principal = isPrincipalPhoto({
                      is_primary: p.is_primary, is_main: false, photo_type: p.photo_type,
                      public_url: p.public_url, image_url: undefined, storage_path: p.storage_path,
                    });
                    return (
                      <div
                        key={p.tempId}
                        style={{
                          position: 'relative',
                          borderRadius: 10,
                          overflow: 'hidden',
                          outline: principal ? '2px solid #d4a24c' : '1px solid #e6e3db',
                          background: '#fff',
                          aspectRatio: '1 / 1',
                        }}
                        title={principal ? 'Foto principal — clique para trocar' : 'Clique para definir como principal'}
                      >
                        <button
                          type="button"
                          onClick={() => setAsPrimary(p.tempId)}
                          style={{
                            display: 'block', width: '100%', height: '100%',
                            padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
                          }}
                        >
                          <img
                            src={p.preview}
                            alt="Prévia anexada"
                            loading="lazy"
                            decoding="async"
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          />
                        </button>
                        <span
                          style={{
                            position: 'absolute', left: 6, top: 6,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: principal ? '#0f172a' : 'rgba(15, 23, 42, 0.55)',
                            color: '#fff',
                            fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                          }}
                        >
                          {principal ? 'PRINCIPAL' : 'Clique p/ principal'}
                        </span>
                        <button
                          type="button"
                          onClick={() => removePhoto(p.tempId)}
                          aria-label="Excluir foto"
                          style={{
                            position: 'absolute', top: 6, right: 6,
                            width: 26, height: 26, borderRadius: 999,
                            border: 'none',
                            background: 'rgba(220, 38, 38, 0.92)',
                            color: '#fff',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 14,
                            lineHeight: 1,
                            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                          }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            <div className="photo-drop">
              Principal · Lateral · Traseira · Cabine<br />
              <small>JPG, PNG ou WebP · até 10 MB por arquivo</small>
            </div>
          </section>
        </aside>
      </form>
    </>
  );
}

function AdminSimple({ title, kicker, description, children }: { title: string; kicker: string; description: string; children?: ReactNode }) { return <><PageHeader kicker={kicker} title={title} description={description} />{children || <div className="empty-state"><Database size={34} /><h3>Em preparação</h3><p>Esta área já está protegida para administradores e pronta para receber os dados.</p></div>}</>; }

type AdminUserRow = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

function AdminUsers() {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      // 1) Tenta TABELA NOVA usuarios_perfil (id, nome, papel, criado_em)
      let r: any = await supabase
        .from('usuarios_perfil')
        .select('id, nome, papel, criado_em')
        .order('criado_em', { ascending: false });
      let usarFallbackProfiles = !!r.error;
      if (usarFallbackProfiles) {
        // 2) Fallback para tabela profiles antiga
        r = await supabase
          .from('profiles')
          .select('id,name,full_name,email,role,active,is_active,created_at,updated_at')
          .order('created_at', { ascending: false });
      }
      if (r.error) {
        const msg = typeof (r.error as unknown as { message?: string }).message === 'string'
          ? (r.error as unknown as { message: string }).message
          : String(r.error);
        setMessage({ kind: 'err', text: `Não foi possível carregar a equipe (${msg}).` });
        return;
      }
      const data = Array.isArray(r.data) ? (r.data as Array<Record<string, unknown>>) : [];
      const mapped: AdminUserRow[] = data.map(row => {
        if (!usarFallbackProfiles) {
          const rawPapel = String(row.papel ?? 'vendedor').toLowerCase();
          const roleNorm: Role = (rawPapel === 'admin' || rawPapel === 'administrador' || rawPapel === 'adm') ? 'admin' : 'seller';
          return {
            id: String(row.id),
            full_name: String(row.nome ?? 'Sem nome'),
            email: '',
            role: roleNorm,
            is_active: true,
            created_at: row.criado_em ? String(row.criado_em) : undefined,
          };
        }
        const rawRole = String(row.role ?? 'seller');
        const roleNorm: Role = (rawRole.toLowerCase() === 'admin' || rawRole.toLowerCase() === 'administrador' || rawRole.toLowerCase() === 'adm') ? 'admin' : 'seller';
        return {
          id: String(row.id),
          full_name: String(row.full_name ?? row.name ?? 'Sem nome'),
          email: String(row.email ?? ''),
          role: roleNorm,
          is_active: Boolean(row.is_active ?? row.active ?? true),
          created_at: row.created_at ? String(row.created_at) : undefined,
          updated_at: row.updated_at ? String(row.updated_at) : undefined,
        };
      });
      setRows(mapped);
    } catch (e) {
      console.error(e);
      setMessage({ kind: 'err', text: 'Não foi possível carregar a equipe.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = rows.filter(u => `${u.full_name} ${u.email}`.toLowerCase().includes(query.toLowerCase()));
  const adminsCount = rows.filter(u => u.role === 'admin').length;
  const activeCount = rows.filter(u => u.is_active).length;

  const remove = async (row: AdminUserRow) => {
    if (!window.confirm(`Excluir o usuário "${row.full_name}"?\nEsta ação apaga a conta e não pode ser desfeita.`)) return;
    setMessage(null);
    try {
      const r = await supabase.rpc('admin_excluir_usuario', { p_perfil_id: row.id });
      if (r.error) throw new Error(r.error.message || String(r.error));
      setMessage({ kind: 'ok', text: 'Usuário excluído.' });
      await load();
    } catch (e) {
      console.error(e);
      setMessage({ kind: 'err', text: 'Não foi possível excluir: ' + (e instanceof Error ? e.message : 'rode a migration 20261009180000_usuarios_perfil_auth_supabase.sql') });
    }
  };

  return <>
    <PageHeader
      kicker="ACESSOS E PERMISSÕES"
      title="Equipe de operação"
      description="Gerencie as contas administrativas e de vendas, defina permissões, ative e desative acessos."
      action={<button className="button button-primary" onClick={() => setShowNew(true)}><Plus size={16}/> Novo usuário</button>}
    />
    <div className="stat-grid" style={{ marginBottom: 22 }}>
      <StatCard label="Total de contas" value={rows.length} icon={Users} accent />
      <StatCard label="Administradores" value={adminsCount} icon={ShieldCheck} />
      <StatCard label="Vendedores" value={Math.max(0, rows.length - adminsCount)} icon={Users} />
      <StatCard label="Contas ativas" value={activeCount} icon={Check} />
    </div>
    <div className="panel" style={{ padding: 18 }}>
      <div className="list-toolbar" style={{ marginBottom: 14 }}>
        <div className="search-box">
          <Search size={17}/>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nome ou e-mail..."/>
        </div>
        <div className="row-actions">
          <button className="icon-button" title="Recarregar" onClick={load}><FileText size={16}/></button>
        </div>
      </div>
      {message && (
        <div style={{
          margin: '0 0 14px',
          padding: '10px 12px',
          borderRadius: 10,
          fontSize: 13,
          background: message.kind === 'ok' ? '#ecfdf5' : '#fef2f2',
          color: message.kind === 'ok' ? '#065f46' : '#991b1b',
          border: '1px solid ' + (message.kind === 'ok' ? '#a7f3d0' : '#fecaca'),
        }}>{message.text}</div>
      )}
      {loading ? (
        <div className="empty-state"><Package size={30}/><h3>Carregando...</h3></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><Users size={34}/><h3>Nenhum usuário encontrado</h3><p>{query ? 'Refine a busca ou limpe os filtros.' : 'Clique em "Novo usuário" para começar.'}</p></div>
      ) : (
        <div className="data-table head">
          <span>Usuário</span><span>Perfil</span><span>Status</span><span>Criado em</span><span />
        </div>
      )}
      {!loading && filtered.map(u => (
        <div className="data-table" key={u.id}>
          <div className="table-machine">
            <div className="table-thumb" style={{ background: 'linear-gradient(135deg,#fff4d6 0%, #f4e6b9 100%)', color: '#8b6f1d', fontWeight: 700 }}>
              {u.full_name.slice(0, 1).toUpperCase() || '?'}
            </div>
            <div>
              <strong>{u.full_name}</strong>
              <small style={{ color: '#78716c' }}>{u.email}</small>
            </div>
          </div>
          <span>
            <span className={`chip ${u.role === 'admin' ? 'selected' : ''}`} style={{ margin: 0 }}>
              {u.role === 'admin' ? <><ShieldCheck size={12}/> Administrador</> : <><Users size={12}/> Vendedor</>}
            </span>
          </span>
          <span>
            <i className={`table-status ${u.is_active ? 'available' : 'sold'}`} style={{ marginRight: 8 }} />
            {u.is_active ? 'Ativo' : 'Desativado'}
          </span>
          <span style={{ color: '#78716c', fontSize: 13 }}>
            {u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '-'}
          </span>
          <div className="row-actions">
            <button title="Editar usuário" onClick={() => setEditing(u)}><Settings size={16}/></button>
            <button title="Excluir usuário" onClick={() => remove(u)}><Trash2 size={16}/></button>
          </div>
        </div>
      ))}
    </div>

    {showNew && <NewUserModal onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); load(); }} setMessage={setMessage}/>}
    {editing && <EditUserModal row={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} setMessage={setMessage}/>}
  </>;
}

type MsgFn = (m: { kind: 'ok' | 'err'; text: string } | null) => void;

// Traduz erros comuns do Supabase Auth para uma mensagem clara em pt-BR
function friendlyCreateError(raw: string): string {
  if (/rate limit|too many requests|over_email_send_rate_limit/i.test(raw)) {
    return 'Limite de envio de e-mails do Supabase atingido. O cadastro por confirmação de e-mail consome uma cota baixa por hora do serviço de e-mail do Supabase. Para não depender dele: desative a confirmação de e-mail (Authentication → Providers → Email) ou configure um SMTP próprio.';
  }
  if (/already registered|already exists|duplicate|unique constraint/i.test(raw)) return 'Já existe um usuário com este e-mail.';
  if (/at least 6|password should be/i.test(raw)) return 'A senha é muito curta (mínimo 6 caracteres).';
  return raw || 'Não foi possível criar o usuário.';
}

function NewUserModal({ onClose, onDone, setMessage }: { onClose: () => void; onDone: () => void; setMessage: MsgFn }) {
  const [busy, setBusy] = useState(false);
  const [full_name, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('seller');
  const [is_active, setActive] = useState(true);
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [localErr, setLocalErr] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalErr('');
    if (full_name.trim().length < 2) { setLocalErr('Informe o nome completo (mínimo 2 caracteres).'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setLocalErr('Informe um e-mail válido.'); return; }
    if (pwd.length < 6) { setLocalErr('A senha temporária precisa de pelo menos 6 caracteres.'); return; }
    if (pwd !== pwd2) { setLocalErr('As senhas não coincidem.'); return; }
    setBusy(true);
    setMessage(null);
    try {
      // === CAMINHO RECOMENDADO: RPC admin_create_user (SECURITY DEFINER) ===
      // Cria o usuário em auth.users JÁ CONFIRMADO (email_confirmed_at = now()),
      // NÃO envia convite por e-mail e NÃO troca a sessão do administrador logado.
      const rpc = await supabase.rpc('admin_create_user', {
        p_email: email.trim().toLowerCase(),
        p_full_name: full_name.trim(),
        p_role: role,
        p_is_active: is_active,
        p_temp_password: pwd,
      });
      if (!rpc.error) {
        const newId = (rpc.data as string | null) ?? null;
        // O trigger handle_new_user cria o perfil como "vendedor" por padrão → sincroniza o papel/ativo reais
        if (newId) {
          try { await supabase.rpc('admin_set_perfil_acesso', { p_perfil_id: newId, p_papel: role, p_ativo: is_active }); } catch { /* opcional */ }
        }
        setMessage({ kind: 'ok', text: 'Usuário criado. Ele já pode entrar com o e-mail e a senha temporária.' });
        onDone();
        return;
      }

      // RPC indisponível (migration não aplicada) ou erro de negócio.
      const rpcMsg = rpc.error.message || String(rpc.error);
      console.warn('[admin_create_user] falhou → tentando signUp:', rpcMsg);
      // E-mail já cadastrado: não cai no signUp (que tentaria enviar outro e-mail e pioraria a cota)
      if (/already exists|duplicate|unique constraint/i.test(rpcMsg)) {
        setLocalErr('Já existe um usuário com este e-mail.');
        return;
      }

      // === FALLBACK: signUp do SDK (quando a migration das RPCs ainda não foi aplicada) ===
      const { data: { session: prev } } = await supabase.auth.getSession();
      const signUpRes = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password: pwd,
        options: {
          data: { nome: full_name.trim(), name: full_name.trim(), full_name: full_name.trim(), papel: role },
          emailRedirectTo: location.origin,
        },
      });
      if (signUpRes.error) throw new Error(signUpRes.error.message || String(signUpRes.error));
      const userId = signUpRes.data.user?.id;
      if (!userId) throw new Error('Conta criada mas sem id de usuário. Recarregue a página.');
      try { await supabase.from('usuarios_perfil').update({ nome: full_name.trim(), papel: role }).eq('id', userId); } catch { /* trigger já criou */ }
      try { await supabase.rpc('admin_set_perfil_acesso', { p_perfil_id: userId, p_papel: role, p_ativo: is_active }); } catch { /* migration ainda não rodou */ }
      // O signUp pode ter logado o novo usuário no client → restaura a sessão do administrador
      if (signUpRes.data.session && prev) {
        try { await supabase.auth.setSession({ access_token: prev.access_token, refresh_token: prev.refresh_token }); } catch { /* ignora */ }
      }
      setMessage({ kind: 'ok', text: 'Usuário criado. Se o login não funcionar, confirme o e-mail do colaborador ou desative a confirmação de e-mail no Supabase.' });
      onDone();
    } catch (err) {
      console.error(err);
      setLocalErr(friendlyCreateError(err instanceof Error ? err.message : ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="zoom-modal form-modal" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <header className="modal-head">
          <div>
            <span className="eyebrow gold">ACESSOS E PERMISSÕES</span>
            <h2>Cadastrar usuário</h2>
            <p className="modal-sub">A conta é criada já confirmada. O colaborador entra com o e-mail e a senha temporária definidos abaixo.</p>
          </div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Fechar"><X size={18}/></button>
        </header>

        <label>Nome completo
          <input value={full_name} onChange={e => setFullName(e.target.value)} placeholder="Ex.: Maria Souza" required minLength={2} maxLength={120} autoFocus/>
        </label>

        <label>E-mail
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="nome@empresa.com" required/>
        </label>

        <div className="grid-2">
          <label>Perfil de acesso
            <select value={role} onChange={e => setRole(e.target.value as Role)}>
              <option value="seller">Vendedor</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
          <div className="switch-field">
            <div>
              <strong>Conta ativa</strong>
              <small>Pode acessar o sistema agora</small>
            </div>
            <button type="button" role="switch" aria-checked={is_active} aria-label="Conta ativa"
              className={is_active ? 'switch on' : 'switch'} onClick={() => setActive(v => !v)}>
              <span />
            </button>
          </div>
        </div>

        <div className="grid-2">
          <label>Senha temporária
            <div className="password-field">
              <input type={showPwd ? 'text' : 'password'} value={pwd} onChange={e => setPwd(e.target.value)} placeholder="Mínimo 6 caracteres" minLength={6} required/>
              <button type="button" onClick={() => setShowPwd(s => !s)} aria-label={showPwd ? 'Ocultar senha' : 'Mostrar senha'}>
                {showPwd ? <EyeOff size={16}/> : <Eye size={16}/>}
              </button>
            </div>
          </label>
          <label>Confirmar senha
            <input type={showPwd ? 'text' : 'password'} value={pwd2} onChange={e => setPwd2(e.target.value)} placeholder="Repita a senha" minLength={6} required/>
          </label>
        </div>
        <small className="field-help">O colaborador usará esta senha no primeiro acesso e poderá alterá-la depois.</small>

        {localErr && <div className="form-error">{localErr}</div>}

        <div className="modal-actions">
          <button type="button" className="button button-outline" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? <><span className="mini-spinner"/> Criando...</> : <><Save size={16}/> Criar usuário</>}
          </button>
        </div>
      </form>
    </div>
  );
}

function EditUserModal({ row, onClose, onDone, setMessage }: { row: AdminUserRow; onClose: () => void; onDone: () => void; setMessage: MsgFn }) {
  const [busy, setBusy] = useState(false);
  const [full_name, setFullName] = useState(row.full_name);
  const [role, setRole] = useState<Role>(row.role);
  const [is_active, setActive] = useState(row.is_active);
  const [localErr, setLocalErr] = useState('');
  const [resetOpen, setResetOpen] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setLocalErr('');
    if (full_name.trim().length < 2) { setLocalErr('Nome inválido.'); return; }
    setBusy(true);
    setMessage(null);
    try {
      // 1) Nome em usuarios_perfil (tabela nova)
      let nomeOk = false;
      try {
        const { error } = await supabase.from('usuarios_perfil').update({ nome: full_name.trim() }).eq('id', row.id);
        nomeOk = !error;
      } catch { nomeOk = false; }
      if (!nomeOk) {
        // Fallback para profiles antiga
        const { error: fbErr } = await supabase
          .from('profiles')
          .update({ full_name: full_name.trim(), name: full_name.trim(), updated_at: new Date().toISOString() })
          .eq('id', row.id);
        if (fbErr) throw new Error(fbErr.message || String(fbErr));
      }
      // 2) Role / ativo: tenta RPC admin_set_perfil_acesso (atualiza usuarios_perfil + profiles antiga + user_roles + banned auth.users)
      try {
        const rpcRes = await supabase.rpc('admin_set_perfil_acesso', {
          p_perfil_id: row.id,
          p_papel: role,
          p_ativo: is_active,
        });
        if (rpcRes.error) throw new Error(rpcRes.error.message || String(rpcRes.error));
      } catch (err) {
        // Fallback: atualiza direto usuarios_perfil.papel se a RPC nao tiver rodado ainda
        try {
          const { error: fbErr } = await supabase.from('usuarios_perfil').update({ papel: role }).eq('id', row.id);
          if (fbErr) throw fbErr;
        } catch {
          throw err;
        }
      }
      setMessage({ kind: 'ok', text: 'Usuário atualizado.' });
      onDone();
    } catch (err) {
      console.error(err);
      setLocalErr(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal-backdrop" onClick={onClose}>
    <form className="zoom-modal" style={{ width: 560, maxWidth: '92vw' }} onClick={e => e.stopPropagation()} onSubmit={save}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div><span className="eyebrow gold">EDITAR ACESSO</span><h2 style={{ margin: '4px 0 0' }}>{row.full_name}</h2></div>
        <button type="button" className="modal-close" onClick={onClose}><X size={18}/></button>
      </div>
      <label>E-mail<input value={row.email} disabled/></label>
      <label>Nome completo<input value={full_name} onChange={e => setFullName(e.target.value)} required minLength={2} maxLength={120}/></label>
      <div className="grid-2">
        <label>Perfil
          <select value={role} onChange={e => setRole(e.target.value as Role)}>
            <option value="seller">Vendedor</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 14px', background: '#fff', border: '1px solid #e7e1cf', borderRadius: 10 }}>
          <span style={{ display: 'block', fontSize: 13, marginBottom: 2 }}>Conta ativa</span>
          <input type="checkbox" style={{ width: 'auto', height: 18, margin: 0 }} checked={is_active} onChange={e => setActive(e.target.checked)}/>
        </label>
      </div>
      {localErr && <div className="form-error" style={{ marginTop: 12 }}>{localErr}</div>}
      <div style={{ marginTop: 14, padding: 12, border: '1px dashed #e5e0cf', borderRadius: 10, background: '#fefbf2' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span className="eyebrow gold">SEGURANÇA · SUPABASE AUTH</span>
            <h4 style={{ margin: '4px 0 0' }}>Senha</h4>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>Envia um link oficial de redefinição de senha do Supabase Authentication para o e-mail do usuário.</p>
          </div>
          <button type="button" className="button button-outline" onClick={() => setResetOpen(true)}><LockKeyhole size={15}/> Resetar senha</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button type="button" className="button button-outline" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="submit" className="button button-primary" style={{ marginLeft: 'auto' }} disabled={busy}>{busy ? 'Salvando...' : 'Salvar alterações'}</button>
      </div>
    </form>
    {resetOpen && (
      <ResetPasswordModal
        user={row}
        onClose={() => setResetOpen(false)}
        onDone={() => { setResetOpen(false); onDone(); }}
        setMessage={setMessage}
      />
    )}
  </div>;
}

function ResetPasswordModal({ user, onClose, onDone, setMessage }: { user: AdminUserRow; onClose: () => void; onDone: () => void; setMessage: MsgFn }) {
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalErr('');
    if (!user.email) { setLocalErr('Esse usuário não tem e-mail cadastrado no Supabase Auth.'); return; }
    setBusy(true);
    setMessage(null);
    try {
      // === VIA SUPABASE AUTH SDK NATIVO: resetPasswordForEmail ===
      // Envia link de redefinição OFICIAL do Supabase Authentication (não precisa de service_role)
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: location.origin });
      if (error) throw new Error(error.message || String(error));
      setMessage({ kind: 'ok', text: `Link de redefinição enviado para ${user.email}. O usuário receberá o e-mail oficial do Supabase Auth.` });
      onDone();
    } catch (err) {
      console.error(err);
      setLocalErr(err instanceof Error ? err.message : 'Erro.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal-backdrop" onClick={onClose}>
    <form className="zoom-modal" style={{ width: 480, maxWidth: '92vw' }} onClick={e => e.stopPropagation()} onSubmit={submit}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div><span className="eyebrow gold">REDEFINIR VIA SUPABASE AUTH</span><h2 style={{ margin: '4px 0 0' }}>{user.full_name}</h2><p className="muted" style={{ marginTop: 6, fontSize: 13 }}>{user.email}</p></div>
        <button type="button" className="modal-close" onClick={onClose}><X size={18}/></button>
      </div>
      <p className="muted">O Supabase Authentication vai enviar um e-mail oficial para <b>{user.email}</b> com um link válido para o usuário criar uma senha nova.</p>
      {localErr && <div className="form-error">{localErr}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button type="button" className="button button-outline" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="submit" className="button button-primary" style={{ marginLeft: 'auto' }} disabled={busy}>{busy ? 'Enviando...' : <><Send size={15}/> Enviar e-mail de reset</>}</button>
      </div>
    </form>
  </div>;
}
function Categories() {
  type Row = { id: string; name: string; is_visible: boolean };
  const [items, setItems] = useState<Row[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    (async () => {
      const r = await supabase.from('categories').select('id,name,is_visible').order('name');
      if (r.data) setItems(r.data as Row[]);
    })();
  }, []);
  const add = async () => {
    const next = name.trim().toUpperCase();
    if (next.length < 2 || items.some(i => i.name.toUpperCase() === next)) return;
    setBusy(true);
    await supabase.from('categories').insert([{ name: next, is_visible: true }]);
    setName(''); setBusy(false);
    const r = await supabase.from('categories').select('id,name,is_visible').order('name');
    if (r.data) setItems(r.data as Row[]);
  };
  const toggle = async (row: Row) => {
    setBusy(true);
    await supabase.from('categories').update({ is_visible: !row.is_visible }).eq('id', row.id);
    setBusy(false);
    const r = await supabase.from('categories').select('id,name,is_visible').order('name');
    if (r.data) setItems(r.data as Row[]);
  };
  const remove = async (row: Row) => {
    if (!window.confirm('Excluir categoria?')) return;
    setBusy(true);
    await supabase.from('categories').delete().eq('id', row.id);
    setBusy(false);
    const r = await supabase.from('categories').select('id,name,is_visible').order('name');
    if (r.data) setItems(r.data as Row[]);
  };
  return (
    <AdminSimple title="Categorias" kicker="ORGANIZAÇÃO DO CATÁLOGO" description="Controle os filtros rápidos usados pela equipe comercial.">
      <div className="inline-form">
        <div className="search-box">
          <Plus size={18} />
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="Nome da nova categoria" />
        </div>
        <button className="button button-primary" onClick={add} disabled={busy}>{busy ? 'Salvando...' : 'Adicionar categoria'}</button>
      </div>
      <div className="category-list">
        {items.map(item => (
          <div className="category-row" key={item.id}>
            <strong>{item.name}{!item.is_visible && <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>· oculta</span>}</strong>
            <div>
              <button className="button button-outline small" onClick={() => toggle(item)} disabled={busy}>{item.is_visible ? 'Ocultar' : 'Mostrar'}</button>
              <button className="icon-danger" onClick={() => remove(item)} disabled={busy} title="Excluir"><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="empty-state"><Database size={30} /><h3>Nenhuma categoria</h3></div>}
      </div>
    </AdminSimple>
  );
}
function Brands({ machines }: { machines: Machine[] }) {
  type Row = { id: string; name: string; is_active: boolean; accent_color?: string | null; slug?: string | null };
  const [items, setItems] = useState<Row[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [editName, setEditName] = useState('');

  const fetchItems = async () => {
    setLoadErr(null);
    try {
      const r = await supabase.from('brands').select('id,name,is_active,accent_color,slug').order('name');
      if (r.error) throw new Error(r.error.message || String(r.error));
      if (r.data) setItems(r.data as Row[]);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
      // fallback: extrai marcas das próprias máquinas como placeholder
      const fallbackMap = new Map<string, number>();
      for (const m of machines) {
        if (!m.brand || m.brand.trim().length < 2) continue;
        const k = m.brand.trim().toUpperCase();
        fallbackMap.set(k, (fallbackMap.get(k) || 0) + 1);
      }
      const fb: Row[] = Array.from(fallbackMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([n], i) => ({
          id: `fb-${i}-${n.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          name: n,
          is_active: true,
          accent_color: '#B8963F',
          slug: n.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        }));
      setItems(fb);
    }
  };

  useEffect(() => { fetchItems(); }, []);

  const count = (rowName: string) => machines.filter(m => (m.brand || '').trim().toUpperCase() === rowName.toUpperCase()).length;

  const add = async () => {
    const next = name.trim().toUpperCase();
    if (next.length < 2 || items.some(i => i.name.toUpperCase() === next)) return;
    setBusy(true);
    try {
      const slug = next.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const r = await supabase.from('brands').insert([{ name: next, slug, accent_color: '#B8963F', is_active: true }]);
      if (r.error) throw new Error(r.error.message || String(r.error));
      setName('');
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      await fetchItems();
    }
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setEditName(row.name);
  };
  const closeEdit = () => { setEditing(null); setEditName(''); };
  const saveEdit = async () => {
    if (!editing) return;
    const next = editName.trim().toUpperCase();
    if (next.length < 2) return;
    if (next === editing.name) { closeEdit(); return; }
    if (items.some(i => i.id !== editing.id && i.name.toUpperCase() === next)) return;
    setBusy(true);
    try {
      const slug = next.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const r = await supabase.from('brands').update({ name: next, slug }).eq('id', editing.id);
      if (r.error) throw new Error(r.error.message || String(r.error));
      closeEdit();
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      await fetchItems();
    }
  };

  const toggleActive = async (row: Row) => {
    setBusy(true);
    try {
      const r = await supabase.from('brands').update({ is_active: !row.is_active }).eq('id', row.id);
      if (r.error) throw new Error(r.error.message || String(r.error));
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      await fetchItems();
    }
  };

  const remove = async (row: Row) => {
    const qtd = count(row.name);
    const msg = qtd > 0
      ? `A marca "${row.name}" tem ${qtd} máquina(s) cadastrada(s). Ao excluir a marca, os nomes das máquinas NÃO são apagados (elas permanecem com o nome atual). Deseja realmente excluir a marca do cadastro?`
      : `Excluir a marca "${row.name}" do cadastro?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const r = await supabase.from('brands').delete().eq('id', row.id);
      if (r.error) throw new Error(r.error.message || String(r.error));
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      await fetchItems();
    }
  };

  return (
    <>
      <AdminSimple
        title="Marcas"
        kicker="IDENTIDADE COMERCIAL · CATÁLOGO"
        description="Cadastre as marcas usadas no catálogo. Ao criar ou editar uma máquina, a marca é escolhida em uma lista. Renomear uma marca reflete automaticamente em TODAS as máquinas correspondentes."
      >
        {loadErr && (
          <div className="form-error" style={{ marginTop: 0, marginBottom: 14 }}>
            ⚠️ Aviso: {loadErr}. Cadastre/rode a migration <code style={{ color: '#b45309' }}>20261009183000_brands_tabela_crud_seed_trigger.sql</code> para ativar CRUD em tabela. Enquanto isso, as marcas estão sendo extraídas das máquinas já cadastradas (modo leitura).
          </div>
        )}

        {/* Barra cadastrar nova marca */}
        <div className="inline-form">
          <div className="search-box">
            <Plus size={18} />
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && add()}
              placeholder="Nome da nova marca (ex: Caterpillar, JCB, Volvo)"
              disabled={!!loadErr || busy}
            />
          </div>
          <button className="button button-primary" onClick={add} disabled={busy || !!loadErr}>
            {busy ? 'Salvando...' : 'Adicionar marca'}
          </button>
        </div>

        {/* Grid de cards (estilo brand-card com ícones editar/excluir discretos no topo) */}
        <div className="brand-grid" style={{ marginTop: 18 }}>
          {items.map(item => {
            const qtd = count(item.name);
            const letter = (item.name || '?').trim().charAt(0).toUpperCase();
            return (
              <div className="brand-card" key={item.id} style={{ position: 'relative' }}>
                {/* ===== Ícones EDITAR (caneta) + DELETAR (lixeira): SEMPRE VISÍVEIS, ACIMA DO CONTADOR ===== */}
                {/* Lado direito do topo do card, acima do número de quantidade de máquinas */}
                <div style={{
                  position: 'absolute', top: 14, right: 18,
                  display: 'flex', gap: 6, zIndex: 5,
                }}
                  aria-hidden={!!loadErr}
                >
                  {/* Lápis = editar */}
                  <button
                    type="button"
                    disabled={busy || !!loadErr}
                    title="Editar marca"
                    onClick={() => openEdit(item)}
                    style={{
                      width: 30, height: 30, borderRadius: 8, border: '1px solid #f0e6c9',
                      background: '#fff', color: '#92400e', cursor: 'pointer',
                      display: 'grid', placeItems: 'center',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                    }}
                    onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#fde68a'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#e0c97a'; }}
                    onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#fff'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#f0e6c9'; }}
                  >
                    <Pencil size={14} />
                  </button>
                  {/* Lixeira = excluir */}
                  <button
                    type="button"
                    disabled={busy || !!loadErr}
                    title="Excluir marca"
                    onClick={() => remove(item)}
                    style={{
                      width: 30, height: 30, borderRadius: 8, border: '1px solid #f5d2c9',
                      background: '#fff', color: '#991b1b', cursor: 'pointer',
                      display: 'grid', placeItems: 'center',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                    }}
                    onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#fecaca'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#fca5a5'; }}
                    onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#fff'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#f5d2c9'; }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="brand-card-top">
                  <div className="brand-symbol">{letter}</div>
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
                    marginLeft: 'auto', textAlign: 'right',
                    /*  Espaço para os ícones não sobrepor o número
                        (largura 2 ícones 30 + gap 6 + margem 18 direita) */
                    paddingTop: 36,
                    minWidth: 106,
                  }}>
                    <strong style={{ fontSize: 22, lineHeight: 1 }}>{qtd}</strong>
                    <span style={{
                      fontSize: 11, letterSpacing: '.06em', color: '#78716c',
                      fontWeight: 600,
                    }}>{qtd === 1 ? 'máquina' : 'máquinas'}</span>
                  </div>
                </div>

                <h2 style={{
                  paddingTop: 10, opacity: item.is_active ? 1 : 0.5,
                  textDecoration: item.is_active ? 'none' : 'line-through',
                }}>
                  {item.name}
                </h2>
                <p style={{ color: item.is_active ? '#78716c' : '#a8a29e' }}>
                  {item.is_active
                    ? (qtd > 0 ? `${qtd} modelo(s) · ativa no catálogo` : 'Nenhum modelo cadastrado')
                    : 'Marca inativa (oculta dos filtros)'}
                </p>

                <div style={{
                  marginTop: 12, display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', gap: 8, flexWrap: 'wrap',
                }}>
                  <button className="text-button"
                    onClick={() => toggleActive(item)}
                    disabled={busy || !!loadErr}
                    style={{ textDecoration: 'none' }}
                  >
                    {item.is_active ? <> <EyeOff size={13}/> Desativar</> : <> <Eye size={13}/> Reativar</>}
                  </button>

                  <button className="text-button"
                    onClick={() => openEdit(item)}
                    disabled={busy || !!loadErr}
                  >
                    Editar <ChevronRight size={14}/>
                  </button>
                </div>
              </div>
            );
          })}

          {items.length === 0 && (
            <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
              <Database size={30} />
              <h3>Nenhuma marca cadastrada</h3>
              <p>Cadastre a primeira marca acima. Ao salvar, ela aparecerá aqui como card.</p>
            </div>
          )}
        </div>
      </AdminSimple>

      {/* ===== Modal Editar Marca ===== */}
      {editing && (
        <div className="modal-backdrop" onClick={closeEdit}>
          <form
            className="zoom-modal"
            style={{ width: 440, maxWidth: '92vw' }}
            onClick={e => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); saveEdit(); }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span className="eyebrow gold">EDITAR MARCA</span>
                <h2 style={{ margin: '4px 0 0' }}>{editing.name}</h2>
                <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                  Atualmente com {count(editing.name)} máquina(s). Ao renomear, todas as máquinas recebem o novo nome automaticamente.
                </p>
              </div>
              <button type="button" className="modal-close" onClick={closeEdit}><X size={18}/></button>
            </div>
            <div style={{ marginTop: 16 }}>
              <label style={{
                fontSize: 13, color: '#57534e', fontWeight: 600,
                display: 'block', marginBottom: 6,
              }}>
                Nome da marca *
                <input
                  style={{ marginTop: 6 }}
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder="Ex: Caterpillar"
                  required
                  autoFocus
                />
              </label>
              <label style={{
                fontSize: 13, color: '#57534e', fontWeight: 600,
                display: 'block', marginTop: 12, marginBottom: 6,
              }}>
                Situação
                <select
                  style={{ marginTop: 6 }}
                  value={editing.is_active ? '1' : '0'}
                  onChange={(e) => {
                    const want = e.target.value === '1';
                    if (want !== editing.is_active) {
                      void toggleActive({ ...editing, is_active: want });
                      setEditing(p => p ? { ...p, is_active: want } : p);
                    }
                  }}
                >
                  <option value="1">Ativa (aparece nos filtros e cadastro)</option>
                  <option value="0">Inativa (oculta de filtros e cadastro)</option>
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button type="button" className="button button-outline" onClick={closeEdit} disabled={busy}>
                Cancelar
              </button>
              <button type="submit" className="button button-primary" style={{ marginLeft: 'auto' }} disabled={busy}>
                {busy ? 'Salvando...' : <><Save size={15}/> Salvar alterações</>}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
function Proposals() { const [brands] = useState(demoBrands); const [segments] = useState(demoSegments); const [brand, setBrand] = useState(brands[0].id); const [segment, setSegment] = useState(segments[0].id); const [client, setClient] = useState(''); const [credit, setCredit] = useState(''); const [entry, setEntry] = useState(''); const [installment, setInstallment] = useState(''); const [term, setTerm] = useState('60'); const [generated, setGenerated] = useState(false); const chosenSegment = segments.find(s => s.id === segment)!; const chosenBrand = brands.find(b => b.id === brand)!; const submit = (e: FormEvent) => { e.preventDefault(); if (!client || !credit || !installment) return; setGenerated(true); }; return <><PageHeader kicker="PROPOSTAS COMERCIAIS" title="Gerar uma proposta" description="Preencha apenas os dados do negócio. As taxas oficiais entram automaticamente." action={<Link to="/propostas/historico" className="button button-outline"><FileText size={16} /> Histórico</Link>} /><div className="proposal-layout"><form className="proposal-form" onSubmit={submit}><section className="form-card"><div className="form-card-heading"><div><span className="eyebrow gold">01 · CONFIGURAÇÃO</span><h2>Escolha a operação</h2></div><Calculator size={20} /></div><div className="form-grid"><label>Marca<select value={brand} onChange={e => setBrand(e.target.value)}>{brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Segmento<select value={segment} onChange={e => setSegment(e.target.value)}>{segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div><div className="locked-rates"><div className="locked-heading"><LockKeyhole size={16} /><strong>Taxas oficiais da operação</strong><span>Definido pela administração</span></div><div className="rate-grid"><div><small>Administração</small><strong>18,00%</strong></div><div><small>Fundo de reserva</small><strong>2,00%</strong></div><div><small>Seguro prestamista</small><strong>0,04%</strong></div></div></div></section><section className="form-card"><div className="form-card-heading"><div><span className="eyebrow gold">02 · DADOS VARIÁVEIS</span><h2>Informações do cliente e plano</h2></div><Users size={20} /></div><div className="form-grid"><label className="span-2">Nome do cliente<input value={client} onChange={e => setClient(e.target.value)} placeholder="Pessoa física ou jurídica" required /></label><label>Valor do bem / crédito<input type="number" value={credit} onChange={e => setCredit(e.target.value)} placeholder="R$ 0,00" required /></label><label>Valor de adesão<input type="number" value={entry} onChange={e => setEntry(e.target.value)} placeholder="R$ 0,00" /></label><label>Parcela mensal<input type="number" value={installment} onChange={e => setInstallment(e.target.value)} placeholder="R$ 0,00" required /></label><label>Prazo (meses)<input type="number" value={term} min={chosenSegment.min_term} max={chosenSegment.max_term} onChange={e => setTerm(e.target.value)} required /><small className="field-help">Permitido: {chosenSegment.min_term} a {chosenSegment.max_term} meses</small></label></div><button className="button button-primary full" type="submit"><FileText size={17} /> Gerar proposta em PDF</button></section></form><aside className="proposal-preview"><div className="preview-toolbar"><span>PRÉVIA DO DOCUMENTO</span><span className="live-dot">AO VIVO</span></div><div className="pdf-page"><div className="pdf-header"><Logo compact /><span>PARCEIRO AUTORIZADO</span></div><div className="pdf-title"><span>SIMULAÇÃO DE CRÉDITO</span><h2>Proposta de consórcio</h2><small>PROP. 0001 · {chosenSegment.name.toUpperCase()} · {date(new Date())}</small></div><div className="pdf-client"><small>PROPOSTA PREPARADA PARA</small><strong>{client || 'Nome do cliente'}</strong></div><div className="pdf-cards"><div><small>VALOR DO CRÉDITO</small><strong>{credit ? money(Number(credit)) : 'R$ 0,00'}</strong></div><div><small>ADESÃO</small><strong>{entry ? money(Number(entry)) : 'R$ 0,00'}</strong></div><div><small>PARCELA MENSAL</small><strong>{installment ? money(Number(installment)) : 'R$ 0,00'}</strong></div><div><small>PRAZO</small><strong>{term} meses</strong></div></div><h4>COMPOSIÇÃO DA TAXA ADMINISTRATIVA</h4><div className="pdf-rates"><div><span>Taxa de administração total</span><b>18,00%</b></div><div><span>Fundo de reserva</span><b>2,00%</b></div><div><span>Seguro prestamista</span><b>0,04%</b></div></div><p className="pdf-note">As taxas apresentadas são oficiais e definidas pela administração. Os valores já estão considerados na composição da parcela.</p><div className="pdf-footer"><strong>{chosenBrand.name}</strong><span>Proposta válida para análise de crédito · Consulte condições completas</span></div></div>{generated && <div className="generated-banner"><Check size={16} /> Proposta criada. O download ficará disponível no documento final.</div>}</aside></div></>; }

function ProfilePage({ profile, onUpdate }: { profile: Profile; onUpdate: (profile: Profile) => void }) {
  const [name, setName] = useState(profile.full_name);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) return;
    setSaving(true); setMessage('');
    // 1) Tenta usuarios_perfil.nome
    let ok = false;
    try {
      const { error } = await supabase
        .from('usuarios_perfil')
        .update({ nome: name.trim() })
        .eq('id', profile.id);
      ok = !error;
    } catch { ok = false; }
    if (!ok) {
      // 2) Fallback para profiles antiga
      try {
        const { error } = await supabase
          .from('profiles')
          .update({ full_name: name.trim(), name: name.trim(), updated_at: new Date().toISOString() })
          .eq('id', profile.id);
        ok = !error;
      } catch { ok = false; }
    }
    if (ok) {
      const updated: Profile = { ...profile, full_name: name.trim() };
      onUpdate(updated);
      setMessage('Perfil atualizado.');
    } else {
      setMessage('Não foi possível atualizar o perfil.');
    }
    setSaving(false);
  };
  return <><PageHeader kicker="MINHA CONTA" title="Perfil do usuário" description="Mantenha seus dados de acesso e identificação atualizados." /><div className="profile-layout"><section className="form-card profile-card"><div className="profile-hero"><div className="profile-avatar">{profile.full_name.slice(0, 1).toUpperCase()}</div><div><span className="eyebrow gold">ACESSO INDIVIDUAL</span><h2>{profile.full_name}</h2><p className="muted">{profile.role === 'admin' ? 'Administrador' : 'Vendedor'} · conta ativa</p></div></div><form onSubmit={save}><label>Nome completo<input value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={120} required /></label><label>E-mail<input value={profile.email} disabled /></label><label>Perfil de acesso<input value={profile.role === 'admin' ? 'Administrador' : 'Vendedor'} disabled /></label>{message && <div className="form-success"><Check size={16} /> {message}</div>}<button className="button button-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button></form></section><aside className="form-card account-security"><ShieldCheck size={22} /><span className="eyebrow gold">SEGURANÇA</span><h2>Seu acesso é individual</h2><p className="muted">A senha só pode ser redefinida por um administrador da operação. Se precisar de ajuda, fale com a gestão.</p><div className="security-row"><LockKeyhole size={17} /><span>Autenticação por e-mail e senha</span></div><div className="security-row"><Users size={17} /><span>Permissões baseadas no perfil</span></div></aside></div></>;
}

/* =========================================================================
   PÁGINA HOME PÚBLICA (VITRINE DO CATÁLOGO) — SEM AUTENTICAÇÃO
   Design moderno, UI/UX sênior, seguindo o design system do produto.
   ========================================================================= */

type CategoryChip = { id: string; name: string; count: number };
type BrandChip = { id: string; name: string; count: number; accent_color?: string };

function PublicCatalog() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [categories, setCategories] = useState<CategoryChip[]>([]);
  const [brands, setBrands] = useState<BrandChip[]>([]);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  // Renderização progressiva: mostra PAGE_SIZE máquinas e carrega mais conforme o usuário rola
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

  // ============ Carrega dados (público, sem profile necessário) ============
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // 1) Máquinas + fotos (mesmo carregamento do admin mas sem precisar de auth pq RLS tem SELECT público)
        const cols = [
          'id','code','internal_code','brand','model','display_name',
          'category','category_id','price','value','down_payment','installment',
          'year','manufacture_year','status','power','operating_weight','hours','location',
          'description','notes','applications','specs',
          'categories:category_id(name)',
          'machine_photos(id,storage_path,public_url,is_primary,photo_type)'
        ].join(',');
        let rows: Array<Record<string, unknown>> = [];
        const q = await supabase
          .from('machines')
          .select(cols, { head: false })
          .eq('status', 'available')
          .order('updated_at', { ascending: false });
        if (q.error || !q.data || q.data.length === 0) {
          const fb = await supabase.from('machines').select('*').eq('status', 'available').order('updated_at', { ascending: false });
          if (fb.data && fb.data.length > 0) rows = fb.data.map(r => r as unknown as Record<string, unknown>);
        } else {
          rows = q.data.map(r => r as unknown as Record<string, unknown>);
        }
        let effective: Machine[] = []; // lista realmente carregada (usada p/ montar os filtros)
        if (rows.length > 0) {
          const ids = rows.map(r => String(r.id));
          const photosByMachine: Record<string, MachinePhoto[]> = {};
          try {
            const pr = await supabase
              .from('machine_photos')
              .select('id,machine_id,storage_path,public_url,is_primary,photo_type')
              .in('machine_id', ids);
            if (pr.data && pr.data.length > 0) {
              for (const p of pr.data as Array<MachinePhoto & { machine_id: string }>) {
                const k = String(p.machine_id);
                (photosByMachine[k] ||= []).push(p);
              }
            } else {
              const ir = await supabase
                .from('machine_images')
                .select('id,machine_id,storage_path,public_url,image_url,is_main,photo_type,label')
                .in('machine_id', ids);
              if (ir.data && ir.data.length > 0) {
                for (const p of ir.data as Array<MachinePhoto & { image_url?: string; is_main?: boolean; label?: string; machine_id: string }>) {
                  const k = String(p.machine_id);
                  (photosByMachine[k] ||= []).push({
                    public_url: p.public_url ?? p.image_url,
                    storage_path: p.storage_path,
                    is_primary: isPrincipalPhoto(p),
                    photo_type: (typeof p.photo_type === 'string' && p.photo_type) || p.label || 'other'
                  });
                }
              }
            }
          } catch (err) { console.warn(err); }
          const list = rows.map(r => {
            const k = String(r.id);
            const attached = photosByMachine[k];
            if (attached && attached.length > 0) return mapMachineRow({ ...r, machine_photos: attached });
            return mapMachineRow(r);
          });
          setMachines(list);
          effective = list;
        } else {
          // Sem máquinas no banco: vitrine vazia (sem dados de demonstração)
          setMachines([]);
          effective = [];
        }

        // 2) Categorias
        const catRows: CategoryChip[] = [];
        try {
          const cr = await supabase.from('categories').select('id,name').eq('is_active', true).order('name');
          if (cr.data) for (const c of cr.data as Array<{ id: string; name: string }>) catRows.push({ id: c.id, name: c.name, count: 0 });
        } catch { /* ignore */ }
        if (catRows.length === 0) {
          // fallback: monta categorias pelas próprias máquinas
          const seen = new Map<string, CategoryChip>();
          for (const m of effective) {
            if (!m.category) continue;
            const key = m.category.toLowerCase();
            if (!seen.has(key)) seen.set(key, { id: key, name: m.category.toUpperCase(), count: 0 });
          }
          for (const v of seen.values()) catRows.push(v);
        }
        // Conta por categoria
        for (const c of catRows) {
          c.count = effective.filter(m => m.category && (String(m.category_id) === c.id || m.category.toLowerCase() === c.id || m.category.toUpperCase() === c.name)).length;
        }
        // Categorias que vieram do nome da máquina (sem category_id) tb contam com count > 0
        const extras = new Map<string, number>();
        for (const m of effective) {
          if (!m.category) continue;
          const exists = catRows.some(c => c.name.toLowerCase() === m.category.toLowerCase() || c.id === String(m.category_id));
          if (!exists) extras.set(m.category.toUpperCase(), (extras.get(m.category.toUpperCase()) || 0) + 1);
        }
        for (const [name, count] of extras.entries()) {
          catRows.push({ id: name.toLowerCase(), name, count });
        }
        setCategories(catRows.filter(c => c.count > 0).sort((a, b) => b.count - a.count));

        // 3) Marcas (DINÂMICO 100% da tabela `public.brands` quando disponível)
        const brandRows: BrandChip[] = [];
        try {
          const br = await supabase
            .from('brands')
            .select('id,name,accent_color,slug,is_active')
            .order('name', { ascending: true });
          if (br.data) {
            for (const b of br.data as Array<{ id: string; name: string; accent_color?: string; slug?: string; is_active: boolean }>) {
              // Marcas inativas NÃO aparecem nos filtros da vitrine
              if (!b.is_active) continue;
              brandRows.push({
                id: b.id,
                name: b.name,
                accent_color: b.accent_color,
                count: 0,
              });
            }
          }
        } catch { /* ignore */ }
        if (brandRows.length === 0) {
          // Fallback: extrai as marcas das próprias máquinas caso a tabela brands não exista
          const seen = new Map<string, BrandChip>();
          for (const m of effective) {
            if (!m.brand) continue;
            const cleaned = m.brand.trim();
            if (cleaned.length < 2) continue;
            const key = cleaned.toUpperCase();
            if (!seen.has(key)) {
              seen.set(key, {
                id: key.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                name: key,
                accent_color: '#B8963F',
                count: 0,
              });
            }
          }
          for (const v of seen.values()) brandRows.push(v);
        }
        // Conta máquinas reais por marca (match case-insensitive)
        for (const b of brandRows) {
          b.count = effective.filter(m => {
            if (!m.brand) return false;
            const mb = m.brand.trim().toUpperCase();
            const bb = b.name.trim().toUpperCase();
            return mb === bb || String(m.brand) === b.id;
          }).length;
        }
        // Marcas novas sem máquinas ainda = aparecem mas com count 0? NÃO: melhor filtrar para o chip só aparecer
        // se a marca tem pelo menos 1 máquina cadastrada (evita ruído na vitrine)
        setBrands(
          brandRows
            .filter(b => b.count > 0)
            .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name))
        );
      } catch (e) { console.error(e); } finally { setLoading(false); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============ Filtros ============
  // ============ Helper: resolve selectedBrand -> marca (name trim.upper normalizado)
  const getBrandMatchUpper = (sel: string | null): string | null => {
    if (!sel) return null;
    // Caso 1: selectedBrand é um UUID (id da tabela brands) ou um name — tenta achar a linha no chips brands[]
    const row = brands.find(b => b.id === sel || b.name.toLowerCase() === sel.toLowerCase());
    if (row) return row.name.trim().toUpperCase();
    // Caso 2: fallback (modo compatível sem tabela brands): é o próprio nome passado
    return sel.trim().toUpperCase();
  };
  const brandMatchUpper = getBrandMatchUpper(selectedBrand);

  const filtered = machines.filter(m => {
    const hay = `${m.display_name} ${m.brand} ${m.model} ${m.category} ${m.location}`.toLowerCase();
    if (query.trim() && !hay.includes(query.toLowerCase())) return false;
    if (selectedCategory) {
      const match = m.category && (
        String(m.category_id) === selectedCategory ||
        m.category.toLowerCase() === selectedCategory.toLowerCase() ||
        m.category.toUpperCase() === selectedCategory.toUpperCase()
      );
      if (!match) return false;
    }
    if (brandMatchUpper) {
      if (!m.brand) return false;
      // MESMA lógica do count dos chips: trim().toUpperCase() ===
      const mb = m.brand.trim().toUpperCase();
      if (mb !== brandMatchUpper) return false;
    }
    return true;
  });

  const groupedByCategory = new Map<string, Machine[]>();
  for (const m of filtered) {
    const k = (m.category || 'OUTROS').toUpperCase();
    if (!groupedByCategory.has(k)) groupedByCategory.set(k, []);
    groupedByCategory.get(k)!.push(m);
  }
  const groupOrder = Array.from(groupedByCategory.keys()).sort();

  // Reinicia a paginação sempre que os filtros mudam
  useEffect(() => { setVisibleLimit(PAGE_SIZE); }, [query, selectedCategory, selectedBrand]);

  // A lista "achatada" (na ordem dos grupos) permite fatiar por PAGE_SIZE mantendo o agrupamento
  const orderedItems = groupOrder.flatMap(cat => (groupedByCategory.get(cat) || []).map(m => ({ cat, m })));
  const totalItems = orderedItems.length;
  const visibleItems = orderedItems.slice(0, visibleLimit);
  const visibleGrouped = new Map<string, Machine[]>();
  for (const { cat, m } of visibleItems) {
    if (!visibleGrouped.has(cat)) visibleGrouped.set(cat, []);
    visibleGrouped.get(cat)!.push(m);
  }
  const visibleGroupOrder = Array.from(visibleGrouped.keys());

  // Carrega mais máquinas ao aproximar o fim da lista (scroll infinito via janela)
  useEffect(() => {
    if (totalItems <= PAGE_SIZE) return;
    const onScroll = () => {
      const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 700;
      if (nearBottom) setVisibleLimit(l => (l < totalItems ? Math.min(l + PAGE_SIZE, totalItems) : l));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [totalItems, visibleLimit]);

  // ============ Funções de card ============
  const goDetail = (id: string) => navigate(`/maquina/${id}`, { state: { fromPublic: true } });
  const copyOffer = (m: Machine) => {
    const lines = buildOfferText(m);
    try {
      if (navigator.clipboard) navigator.clipboard.writeText(lines);
      alert('Oferta copiada!');
    } catch { alert(lines); }
  };
  const statusLabel = (s: string) => {
    switch (normalizeStatus(s)) {
      case 'available': return { label: 'DISPONÍVEL', cls: 'available' };
      case 'negotiating': return { label: 'EM NEGOCIAÇÃO', cls: 'reserved' };
      case 'sold': return { label: 'VENDIDO', cls: 'sold' };
      default: return { label: 'INDISPONÍVEL', cls: 'sold' };
    }
  };

  return (
    <div className="public-home" style={{ minHeight: '100vh', background: '#f5f2ec' }}>
      {/* ===================== HEADER PÚBLICO ===================== */}
      <header className="public-header" style={{
        background: '#fff',
        borderBottom: '1px solid #ece4d0',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div className="public-header-row">
          <div style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>
            <Logo />
          </div>
          <div className="public-search">
            <Search size={17} style={{ position: 'absolute', left: 14, color: '#8c8166' }} />
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Pesquisar máquina, marca ou modelo…"
              style={{
                width: '100%', padding: '12px 16px 12px 42px', borderRadius: 14,
                border: '1px solid #e3dbc5', background: '#fbf7ee', fontSize: 14,
                outline: 'none', color: '#1c1917',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#b8963f'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(184,150,63,0.15)'; e.currentTarget.style.background = '#fff'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#e3dbc5'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.background = '#fbf7ee'; }}
            />
          </div>
          <div className="public-header-actions">
            <button
              className="button button-outline"
              title="Comparar máquinas"
              onClick={() => navigate('/comparar', { state: { fromPublic: true } })}
              style={{ padding: '10px 16px', fontSize: 14, background: '#fff' }}
            >
              <Grid2X2 size={15}/> <span className="hide-sm">Comparar máquinas</span>
            </button>
            <button
              className="button button-primary"
              title="Acesso equipe"
              onClick={() => navigate('/login')}
              style={{ padding: '10px 18px', fontSize: 14 }}
            >
              <LockKeyhole size={15}/> <span className="hide-sm">Acesso equipe</span>
            </button>
          </div>
        </div>
      </header>

      {/* ===================== HERO / INTRO ===================== */}
      <section style={{ maxWidth: 1200, margin: '24px auto 10px', padding: '0 22px' }}>
        <div className="public-hero">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span className="eyebrow" style={{ color: '#b8963f' }}>EIXO-CATÁLOGO</span>
            </div>
            <h1 style={{ fontSize: 36, letterSpacing: '-.035em', lineHeight: 1.08, margin: '0 0 12px' }}>
              Catálogo de <span style={{ color: '#b8963f' }}>Máquinas</span>
            </h1>
            <p className="muted" style={{ fontSize: 15, maxWidth: 520, marginBottom: 20 }}>
              Para cada trabalho, o máquinario certo— modelos, especificações e condições de compra.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button className="button button-primary" onClick={() => {
                const el = document.getElementById('vitrine-grid');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }} style={{ padding: '12px 20px' }}>
                <Zap size={16}/> Encontrar minha máquina
              </button>
              <button className="button button-outline" onClick={() => navigate('/comparar', { state: { fromPublic: true } })} style={{ padding: '12px 20px', background: '#fff' }}>
                <Grid2X2 size={16}/> Comparar máquinas
              </button>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 12px', borderRadius: 999,
                background: '#ecfdf5', color: '#065f46',
                fontSize: 12, fontWeight: 600, border: '1px solid #bbf7d0',
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
                Atualizado em tempo real
              </span>
            </div>
          </div>
          <div className="public-hero-media">
            {[
              machines.find(m => !!m.image)?.image,
              machines.find(m => m.id !== machines.find(x => x.image)?.id && !!m.photos?.[0]?.public_url)?.photos?.[0]?.public_url,
            ].filter(Boolean).slice(0, 2).map((src, i) => (
              <div key={i} className="public-hero-thumb" style={{
                width: 220, height: 160, borderRadius: 18, overflow: 'hidden',
                background: 'linear-gradient(135deg, #fff4d6 0%, #f4e6b9 100%)',
                border: '1px solid #ede2c0',
                marginLeft: i === 1 ? -40 : 0,
                boxShadow: '0 8px 30px rgba(184, 150, 63, 0.14)',
                zIndex: i === 0 ? 2 : 1,
                position: 'relative',
              }}>
                {src && <div className="img-shimmer" aria-hidden="true" />}
                {src ? (
                  <SmartImg src={src} alt="" width={800} priority style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', position: 'relative', zIndex: 1 }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
                    <ImageIcon size={52} style={{ color: '#b8963f', opacity: 0.75 }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== FILTROS ===================== */}
      <section style={{ maxWidth: 1200, margin: '24px auto 0', padding: '0 22px' }}>
        {/* Categorias */}
        <div style={{ marginBottom: 14 }}>
          <div className="eyebrow" style={{ color: '#78716c', fontSize: 12, letterSpacing: '.08em', margin: '0 0 10px 2px' }}>CATEGORIAS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button
              onClick={() => setSelectedCategory(null)}
              style={{
                padding: '10px 16px', borderRadius: 999, border: '1px solid',
                borderColor: !selectedCategory ? '#b8963f' : '#e3dbc5',
                background: !selectedCategory ? '#fef9ea' : '#fff',
                color: !selectedCategory ? '#8b6f1d' : '#44403c',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 10,
                boxShadow: !selectedCategory ? 'inset 0 0 0 1px rgba(184,150,63,0.25)' : 'none',
              }}
            >
              <LayoutDashboard size={14}/> Todas
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: !selectedCategory ? '#f4e5b4' : '#f3efe4', color: '#524412', fontWeight: 700 }}>
                {machines.length}
              </span>
            </button>
            {categories.map(c => {
              const active = selectedCategory === c.id || selectedCategory === c.name;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedCategory(active ? null : c.id)}
                  style={{
                    padding: '10px 16px', borderRadius: 999, border: '1px solid',
                    borderColor: active ? '#b8963f' : '#e3dbc5',
                    background: active ? '#fef9ea' : '#fff',
                    color: active ? '#8b6f1d' : '#44403c',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 10,
                  }}
                >
                  <Package size={14} style={{ opacity: 0.75 }} /> {c.name}
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: active ? '#f4e5b4' : '#f3efe4', color: '#524412', fontWeight: 700 }}>
                    {c.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Marcas */}
        <div>
          <div className="eyebrow" style={{ color: '#78716c', fontSize: 12, letterSpacing: '.08em', margin: '0 0 10px 2px' }}>MARCAS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button
              onClick={() => setSelectedBrand(null)}
              style={{
                padding: '8px 14px', borderRadius: 999, border: '1px solid',
                borderColor: !selectedBrand ? '#b8963f' : '#e3dbc5',
                background: !selectedBrand ? '#fef9ea' : '#fff',
                color: !selectedBrand ? '#8b6f1d' : '#44403c',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Todas
            </button>
            {brands.map(b => {
              const active = selectedBrand === b.id || selectedBrand === b.name;
              return (
                <button
                  key={b.id}
                  onClick={() => setSelectedBrand(active ? null : b.id)}
                  style={{
                    padding: '8px 14px', borderRadius: 999, border: '1px solid',
                    borderColor: active ? '#b8963f' : '#e3dbc5',
                    background: active ? '#fef9ea' : '#fff',
                    color: active ? '#8b6f1d' : '#44403c',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                  }}
                >
                  <Tags size={12} style={{ opacity: 0.7 }} /> {b.name}
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#78716c' }}>{b.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Resultado */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '22px 0 12px', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: 14, color: '#44403c', fontWeight: 600 }}>
            {loading ? 'Carregando…' : `${filtered.length} máquina${filtered.length === 1 ? '' : 's'} encontrada${filtered.length === 1 ? '' : 's'}`}
            {selectedCategory && <> · categoria <b style={{ color: '#8b6f1d' }}>{categories.find(c => c.id === selectedCategory || c.name.toLowerCase() === selectedCategory.toLowerCase())?.name || selectedCategory.toUpperCase()}</b></>}
            {selectedBrand && <> · marca <b style={{ color: '#8b6f1d' }}>{brands.find(b => b.id === selectedBrand || b.name.toLowerCase() === selectedBrand.toLowerCase())?.name || selectedBrand.toUpperCase()}</b></>}
          </div>
          <button className="button button-outline" onClick={() => navigate('/comparar', { state: { fromPublic: true } })} style={{ padding: '8px 14px', fontSize: 13, background: '#fff' }}>
            <Grid2X2 size={14}/> Ir para Comparar →
          </button>
        </div>
      </section>

      {/* ===================== GRID DE CARDS (POR CATEGORIA) ===================== */}
      <main id="vitrine-grid" style={{ maxWidth: 1200, margin: '0 auto 52px', padding: '10px 22px 20px' }}>
        {loading ? (
          <div className="empty-state" style={{ background: '#fff', borderRadius: 18, border: '1px solid #ece4d0', padding: 60 }}>
            <div className="spinner" style={{ marginBottom: 10 }} />
            <p className="muted">Carregando vitrine…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state" style={{ background: '#fff', borderRadius: 18, border: '1px solid #ece4d0', padding: 60 }}>
            <Package size={36} style={{ color: '#b8963f', marginBottom: 8 }} />
            <h3 style={{ margin: 0 }}>Nenhuma máquina corresponde aos filtros</h3>
            <p className="muted" style={{ maxWidth: 520 }}>Tente limpar os filtros de categoria e marca ou pesquisar outro termo.</p>
            <button className="button button-outline" onClick={() => { setQuery(''); setSelectedCategory(null); setSelectedBrand(null); }} style={{ marginTop: 6 }}>
              Limpar filtros
            </button>
          </div>
        ) : (
          visibleGroupOrder.map(catName => {
            const list = visibleGrouped.get(catName)!;
            return (
              <section key={catName} style={{ marginBottom: 34 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  margin: '0 0 14px',
                  padding: '2px 4px',
                  borderBottom: '1px dashed #e2d9be',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 10, background: '#fef4d6',
                      display: 'grid', placeItems: 'center', color: '#8b6f1d',
                      border: '1px solid #f2e3ad',
                    }}>
                      <Package size={15}/>
                    </div>
                    <h3 style={{ fontSize: 14, color: '#524412', fontWeight: 700, letterSpacing: '.1em' }}>{catName}</h3>
                  </div>
                  <span style={{ fontSize: 12, color: '#78716c', fontWeight: 600, letterSpacing: '.06em' }}>
                    {list.length} MODELO{list.length === 1 ? '' : 'S'}
                  </span>
                </div>
                <div className="public-grid" style={{
                  display: 'grid', gap: 18,
                  gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))',
                }}>
                  {list.map(m => {
                    const st = statusLabel(m.status);
                    const primaryImg = m.photos?.find(p => !!p.public_url)?.public_url || m.image;
                    return (
                      <article key={m.id} className="public-card" style={{
                        background: '#fff',
                        border: '1px solid #ece4d0',
                        borderRadius: 18,
                        overflow: 'hidden',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                        display: 'flex', flexDirection: 'column',
                        transition: 'transform 120ms ease, box-shadow 120ms ease',
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 10px 30px rgba(184,150,63,0.12)';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.transform = '';
                        e.currentTarget.style.boxShadow = '';
                      }}>
                        {/* IMAGEM + STATUS */}
                        <div style={{
                          position: 'relative',
                          aspectRatio: '4 / 3',
                          background: 'linear-gradient(135deg, #f3efe2 0%, #e8dfc6 100%)',
                          borderBottom: '1px solid #ece4d0',
                          overflow: 'hidden',
                        }}>
                          {primaryImg && <div className="img-shimmer" aria-hidden="true" />}
                          {primaryImg ? (
                            <SmartImg src={primaryImg} alt={m.display_name} width={480} style={{
                              width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                              position: 'relative', zIndex: 1,
                            }} />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
                              <div style={{ textAlign: 'center', color: '#b8963f' }}>
                                <ImageIcon size={54} style={{ opacity: 0.85 }} />
                                <div style={{ marginTop: 10, fontSize: 11, fontWeight: 600, letterSpacing: '.08em', color: '#78716c' }}>
                                  FOTO NÃO CADASTRADA
                                </div>
                              </div>
                            </div>
                          )}
                          <div style={{
                            position: 'absolute', top: 12, left: 12,
                            display: 'flex', alignItems: 'center', gap: 10,
                          }}>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              padding: '5px 10px', borderRadius: 999,
                              fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
                              background: st.cls === 'available' ? '#ecfdf5' : st.cls === 'reserved' ? '#fff8e1' : '#fef2f2',
                              color: st.cls === 'available' ? '#065f46' : st.cls === 'reserved' ? '#92400e' : '#991b1b',
                              border: '1px solid ' + (st.cls === 'available' ? '#bbf7d0' : st.cls === 'reserved' ? '#fde68a' : '#fecaca'),
                            }}>
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: st.cls === 'available' ? '#10b981' : st.cls === 'reserved' ? '#f59e0b' : '#ef4444' }} />
                              {st.label}
                            </span>
                          </div>
                          <div style={{
                            position: 'absolute', top: 12, right: 12,
                            background: 'rgba(17,17,17,0.72)', color: '#fff',
                            borderRadius: 999, fontSize: 10, fontWeight: 700,
                            padding: '5px 10px', letterSpacing: '.08em',
                          }}>
                            #{(m.internal_code || m.id.slice(0, 3)).toUpperCase()}
                          </div>
                        </div>

                        {/* NOME */}
                        <div style={{ padding: '16px 16px 4px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ fontSize: 11, color: '#78716c', fontWeight: 600, letterSpacing: '.08em' }}>
                            {catName}
                          </div>
                          <div style={{
                            fontSize: 15, fontWeight: 800, color: '#1c1917', letterSpacing: '-.015em', lineHeight: 1.2,
                            minHeight: 36,
                          }}>
                            {`${(m.brand || '').toUpperCase()} ${m.model || ''}`.trim()}
                          </div>
                          <div style={{ marginTop: 2 }}>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              padding: '4px 10px', borderRadius: 999,
                              background: '#fef9ea', color: '#8b6f1d',
                              border: '1px solid #f2e3ad',
                              fontSize: 11, fontWeight: 700,
                            }}>
                              <Check size={12}/> NOVA DE FÁBRICA
                            </span>
                          </div>
                        </div>

                        {/* VALOR */}
                        <div style={{ padding: '10px 16px' }}>
                          <div style={{
                            background: '#fef9ea',
                            border: '1px solid #f2e3ad',
                            borderRadius: 14,
                            padding: '12px 14px',
                          }}>
                            <div style={{
                              fontSize: 10, color: '#8b6f1d', fontWeight: 700, letterSpacing: '.12em',
                              display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2,
                            }}>
                              <Calculator size={12}/> VALOR
                            </div>
                            <div style={{
                              fontSize: 22, fontWeight: 800, color: '#1c1917', letterSpacing: '-.02em', lineHeight: 1,
                            }}>
                              {money(m.value)}
                            </div>
                            <div style={{
                              marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
                            }}>
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 600, color: '#78716c', letterSpacing: '.08em' }}>ENTRADA</div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#292524' }}>{money(m.entry)}</div>
                              </div>
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 600, color: '#78716c', letterSpacing: '.08em' }}>PARCELA</div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#292524' }}>{money(m.installment)}</div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* AÇÕES */}
                        <div style={{ padding: '4px 16px 16px', marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <button className="button button-primary" onClick={() => copyOffer(m)} style={{ width: '100%', padding: '11px 16px', fontSize: 13, justifyContent: 'center', gap: 8 }}>
                            <Clipboard size={15}/> Copiar oferta
                          </button>
                          <button className="button button-outline" onClick={() => goDetail(m.id)} style={{ width: '100%', padding: '10px 16px', fontSize: 13, justifyContent: 'center', background: '#fff' }}>
                            Ver detalhes <ChevronRight size={15}/>
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
        {!loading && totalItems > 0 && visibleLimit < totalItems && (
          <p className="muted" style={{ textAlign: 'center', fontSize: 13, padding: '18px 0' }}>
            Role para ver mais máquinas…
          </p>
        )}
        {!loading && totalItems > 0 && visibleLimit >= totalItems && (
          <p className="muted" style={{ textAlign: 'center', fontSize: 13, padding: '20px 0' }}>
            Você viu todas as {totalItems} máquinas disponíveis.
          </p>
        )}
      </main>

      {/* ===================== FOOTER PÚBLICO ===================== */}
      <footer style={{
        background: '#14120f',
        color: '#d6d3d1',
        padding: '28px 22px 34px',
      }}>
        <div className="public-footer-row">
          <div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 18 }}>Eixo-Catálogo</div>
            <div style={{ color: '#a8a29e', fontSize: 13, marginTop: 4 }}>
              Operação comercial · {new Date().getFullYear()} — Todos os direitos reservados.
            </div>
          </div>
          <div className="public-footer-actions">
            <button className="button button-outline" onClick={() => navigate('/comparar', { state: { fromPublic: true } })} style={{ padding: '10px 16px', fontSize: 13, background: 'transparent', borderColor: '#3f3a33', color: '#fff' }}>
              <Grid2X2 size={14}/> Comparar
            </button>
            <button className="button button-primary" onClick={() => navigate('/login')} style={{ padding: '10px 18px', fontSize: 13 }}>
              <LockKeyhole size={14}/> Acesso equipe
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [machines, setMachines] = useState<Machine[]>([]);

  // Carregamento de máquinas (tanto público quanto autenticado)
  // Carrega MESMO SEM profile — RLS tem SELECT público para visitantes
  useEffect(() => {
    (async () => {
      const cols = [
        'id','code','internal_code','brand','model','display_name',
        'category','category_id','price','value','down_payment','installment',
        'year','manufacture_year','status','power','operating_weight','hours','location',
        'description','notes','applications','specs',
        'categories:category_id(name)',
        'machine_photos(id,storage_path,public_url,is_primary,photo_type)'
      ].join(',');
      let rows: Array<Record<string, unknown>> = [];
      const q = await supabase
        .from('machines')
        .select(cols, { head: false })
        .order('updated_at', { ascending: false });
      if (q.error || !q.data || q.data.length === 0) {
        if (q.error) console.warn('Query com joins falhou, tentando fallback', q.error.message);
        const fb = await supabase.from('machines').select('*').order('updated_at', { ascending: false });
        if (fb.data && fb.data.length > 0) rows = fb.data.map(r => r as unknown as Record<string, unknown>);
      } else {
        rows = q.data.map(r => r as unknown as Record<string, unknown>);
      }
      if (rows.length === 0) { setMachines([]); return; }

      const ids = rows.map(r => String(r.id));
      const photosByMachine: Record<string, MachinePhoto[]> = {};
      let photosOk = false;
      try {
        const pr = await supabase
          .from('machine_photos')
          .select('id,machine_id,storage_path,public_url,is_primary,photo_type')
          .in('machine_id', ids);
        if (pr.data && pr.data.length > 0) {
          for (const p of pr.data as Array<MachinePhoto & { machine_id: string }>) {
            const k = String(p.machine_id);
            (photosByMachine[k] ||= []).push(p);
          }
          photosOk = true;
        } else if (pr.error) {
          console.warn('machine_photos query falhou, tentando machine_images', pr.error.message);
        } else {
          photosOk = true;
        }
      } catch (err) {
        console.warn('machine_photos exceção, tentando machine_images', err);
      }
      if (!photosOk || Object.keys(photosByMachine).length === 0) {
        try {
          const ir = await supabase
            .from('machine_images')
            .select('id,machine_id,storage_path,public_url,image_url,is_main,photo_type,label')
            .in('machine_id', ids);
          if (ir.data && ir.data.length > 0) {
            for (const k of Object.keys(photosByMachine)) delete photosByMachine[k];
            for (const p of ir.data as Array<MachinePhoto & { image_url?: string; is_main?: boolean; label?: string; machine_id: string }>) {
              const k = String(p.machine_id);
              (photosByMachine[k] ||= []).push({
                public_url: p.public_url ?? p.image_url,
                storage_path: p.storage_path,
                is_primary: isPrincipalPhoto(p),
                photo_type: (typeof p.photo_type === 'string' && p.photo_type) || p.label || 'other'
              });
            }
          } else if (ir.error) {
            console.warn('machine_images também falhou', ir.error.message);
          }
        } catch (err) {
          console.warn('machine_images exceção', err);
        }
      }

      setMachines(rows.map(r => {
        const k = String(r.id);
        const attached = photosByMachine[k];
        if (attached && attached.length > 0) {
          const rowPhotos = (r.machine_photos as MachinePhoto[] | undefined) ?? [];
          if (rowPhotos.length === 0) {
            return mapMachineRow({ ...r, machine_photos: attached });
          }
        }
        return mapMachineRow(r);
      }));
    })();
    // Recarrega quando o usuário autentica/sai: anônimo só vê status visíveis,
    // admin vê todos — sem isso a lista do admin ficava vazia após o login.
  }, [profile?.id]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user)
        getProfile(data.session.user.id).then(setProfile).catch(() => supabase.auth.signOut()).finally(() => setLoading(false));
      else setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      (async () => {
        if (!session) setProfile(null);
        else {
          try { setProfile(await getProfile(session.user.id)); }
          catch { await supabase.auth.signOut(); }
        }
      })();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const logout = async () => { await supabase.auth.signOut(); setProfile(null); };
  if (loading) return <Loading />;

  // Usuário NÃO logado: rotas públicas, SEM sidebar de jeito nenhum
  if (!profile) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PublicCatalog />} />
          <Route path="/vitrine" element={<PublicCatalog />} />
          <Route path="/maquina/:id" element={<MachineDetail machines={machines} />} />
          <Route path="/comparar" element={<Compare machines={machines} />} />
          <Route path="/login" element={<Auth onAuth={setProfile} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    );
  }

  // Usuário LOGADO: Home / e /vitrine e /comparar SEM sidebar; todo o resto DENTRO do AppShell.
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PublicCatalog />} />
        <Route path="/vitrine" element={<PublicCatalog />} />
        <Route path="/maquina/:id" element={<MachineDetail machines={machines} />} />
        <Route path="/comparar" element={<Compare machines={machines} />} />
        <Route
          path="*"
          element={
            <AppShell profile={profile} onLogout={logout}>
              <Routes>
                <Route path="/catalogo" element={<Catalog machines={machines} />} />
                <Route path="/propostas" element={<Proposals />} />
                <Route path="/perfil" element={<ProfilePage profile={profile} onUpdate={setProfile} />} />
                <Route path="/login" element={<Navigate to="/admin" replace />} />
                <Route path="/admin" element={profile.role === 'admin' ? <AdminDashboard machines={machines} /> : <Navigate to="/catalogo" replace />} />
                <Route path="/admin/maquinas" element={profile.role === 'admin' ? <AdminMachines machines={machines} setMachines={setMachines} /> : <Navigate to="/catalogo" replace />} />
                <Route path="/admin/maquinas/:id" element={profile.role === 'admin' ? <MachineForm machines={machines} setMachines={setMachines} /> : <Navigate to="/catalogo" replace />} />
                <Route path="/admin/marcas" element={profile.role === 'admin' ? <Brands machines={machines} /> : <Navigate to="/catalogo" replace />} />
                <Route path="/admin/categorias" element={profile.role === 'admin' ? <Categories /> : <Navigate to="/catalogo" replace />} />
                <Route path="/admin/usuarios" element={profile.role === 'admin' ? <AdminUsers /> : <Navigate to="/catalogo" replace />} />
                <Route path="*" element={<Navigate to={profile.role === 'admin' ? '/admin' : '/catalogo'} replace />} />
              </Routes>
            </AppShell>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
export default App;
