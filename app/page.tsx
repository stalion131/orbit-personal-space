'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ArrowUp, Bot, CalendarDays, Check, CheckCheck, Command, Download, GraduationCap, LayoutDashboard, ListTodo, LoaderCircle, Mail, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Workflow, X, Plane, Briefcase, UserRound, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { priorities, spheres, statuses, type Priority, type SphereId, type Operation, type Status, type Task } from '@/lib/tasks';

const sphereIcons = { work: Briefcase, personal: UserRound, travel: Plane, fitness: Workflow, learning: GraduationCap, shopping: ListTodo, meetings: CalendarDays };
const priorityLabels = {low:'Низкий',medium:'Средний',high:'Высокий',critical:'Критический'};
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers); headers.set('Content-Type', 'application/json'); headers.set('X-Orbit-Client', 'dashboard');
  const response = await fetch(path, { ...options, cache: 'no-store', headers });
  const value = await response.json() as {error?: string};
  if (!response.ok) throw new Error(value.error || 'Не удалось выполнить запрос.');
  return value as T;
}
function date(value: string) { return new Date(value).toLocaleString('ru-RU', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}); }
function StatusPill({status}: {status: Status}) {return <span className={`status ${status}`}><i/>{statuses[status]}</span>;}

export default function Home() {
  const [draft, setDraft] = useState('');
  const [sphere, setSphere] = useState<SphereId>('work');
  const [subcategory, setSubcategory] = useState('Лаборатория Комнатного');
  const [dueDate, setDueDate] = useState('');
  const [queue, setQueue] = useState(1);
  const [priority, setPriority] = useState<Priority>('medium');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<'overview' | 'tasks' | 'approvals'>('overview');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [sphereFilter, setSphereFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [info, setInfo] = useState<'agents' | 'about' | null>(null);
  const requestId = useRef<string | null>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await api<{tasks: Task[]}>('/api/tasks', {signal: controller.signal});
        if (!controller.signal.aborted) setTasks(result.tasks);
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Нет соединения с сервером.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [refresh]);

  const selectedTask = tasks.find(task => task.id === selected);
  const approvals = tasks.filter(task => task.status === 'approval');
  const filtered = tasks.filter(task => (view !== 'approvals' || task.status === 'approval') && (statusFilter === 'all' || task.status === statusFilter) && (sphereFilter === 'all' || task.sphere === sphereFilter) && `${task.title} ${task.description} ${spheres.find(item=>item.id===task.sphere)?.name} ${task.subcategory}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>a.queue-b.queue || (b.priority==='critical'?1:0)-(a.priority==='critical'?1:0));
  function navigate(next: typeof view) {setView(next); setStatusFilter('all'); setSphereFilter('all'); setQuery('');}
  function newTask() { navigate('overview'); setTimeout(()=>draftRef.current?.focus(), 0); }
  function changeDraft(value: string) {setDraft(value); requestId.current = null;}
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); if (!draft.trim() || busy) return;
    setBusy(true); setError(''); setNotice('');
    requestId.current ??= crypto.randomUUID();
    try {
      const {task} = await api<{task:Task}>('/api/tasks', {method:'POST', body:JSON.stringify({id:requestId.current,description:draft,sphere,subcategory,dueDate:dueDate||null,queue,priority})});
      setTasks(current=>[task,...current.filter(item=>item.id!==task.id)]);
      navigate('overview'); setDraft(''); requestId.current=null; setRefresh(value=>value+1);
      setNotice('Задача сохранена. Она ожидает подключения оркестратора; автоматическое выполнение пока отключено.');
    } catch(err) {setError(err instanceof Error ? err.message : 'Не удалось сохранить задачу.');}
    finally {setBusy(false);}
  }
  async function act(task: Task, operation: Operation) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{task:Task}>(`/api/tasks/${encodeURIComponent(task.id)}`, {method:'PATCH', body:JSON.stringify({...operation, revision:task.revision})});
      setTasks(current=>current.map(item=>item.id===task.id?result.task:item));
      setNotice(result.task.result || 'Изменение сохранено.');
    } catch(err) {setError(err instanceof Error ? err.message : 'Не удалось записать решение.');}
    finally {setBusy(false);}
  }
  function exportTasks() {
    const blob = new Blob([JSON.stringify({format:'orbit-tasks-v1', exportedAt:new Date().toISOString(), tasks},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const link=document.createElement('a'); link.href=url; link.download='orbit-tasks.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const stats = [
    {icon:ListTodo,label:'Всего задач',value:tasks.length,caption:'Во всех сферах жизни',filter:'all'},
    {icon:Workflow,label:'В работе',value:tasks.filter(t=>t.status==='running').length,caption:'Выполняются сейчас',filter:'running'},
    {icon:ShieldCheck,label:'Ждут решения',value:approvals.length,caption:'Нужно ваше внимание',filter:'approval'},
    {icon:CheckCheck,label:'Завершено',value:tasks.filter(t=>t.status==='completed').length,caption:'Завершённые задачи',filter:'completed'},
  ];

  return <div className="workspace">
    <aside className="sidebar">
      <Link className="brand" href="/" aria-label="Orbit — главная"><span className="brand-icon"><Command size={23}/></span>orbit<span className="brand-dot">.</span></Link>
      <div className="workspace-label">ЛИЧНОЕ ПРОСТРАНСТВО</div>
      <nav aria-label="Основная навигация">
        <Button className={`nav-item ${view==='overview'?'active':''}`} variant="ghost" onClick={()=>navigate('overview')}><LayoutDashboard/>Обзор</Button>
        <Button className={`nav-item ${view==='tasks'?'active':''}`} variant="ghost" onClick={()=>navigate('tasks')}><ListTodo/>Все задачи<span>{tasks.length}</span></Button>
        <Button className={`nav-item ${view==='approvals'?'active':''}`} variant="ghost" onClick={()=>navigate('approvals')}><ShieldCheck/>Подтверждения<span className="count">{approvals.length}</span></Button>
      </nav>
      <div className="workspace-label section-label">СИСТЕМА</div>
      <nav aria-label="Информация о системе"><Button className="nav-item" variant="ghost" onClick={()=>setInfo('agents')}><Bot/>Агенты</Button><Button className="nav-item" variant="ghost" onClick={()=>setInfo('about')}><Settings2/>О прототипе</Button></nav>
      <div className="sidebar-bottom"><div className="safe-note"><ShieldCheck size={19}/><strong>Вы управляете решениями</strong><p>Важные действия — только<br/>с вашего подтверждения.</p></div><div className="profile"><span className="avatar">В</span><div><strong>Моё пространство</strong><small>Локальный прототип · v0.1</small></div></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div>Рабочее пространство <span>/</span> <strong>{view==='overview'?'Обзор':view==='tasks'?'Все задачи':'Подтверждения'}</strong></div><span className="local-status"><i/>Локальный режим</span></header>
      <main className="main-content">
        <div className="heading-row"><div><div className="eyebrow">МЕНЬШЕ РУТИНЫ. БОЛЬШЕ ВАЖНОГО.</div><h1>{view==='overview'?'Всё под контролем':view==='tasks'?'Каждая задача на виду':'Решение за вами'}<span>.</span></h1><p>{view==='approvals'?'Проверьте предложение до того, как оно станет действием.':'Ваши задачи и решения — в одном пространстве.'}</p></div><Button className="primary-button" onClick={newTask}><Plus/>Новая задача</Button></div>
        <div className="mode-row"><span/><Button variant="ghost" className="export-button" disabled={loading || !tasks.length} onClick={exportTasks}><Download size={14}/>Экспорт</Button></div>
        <div className="demo-banner real-banner"><Sparkles size={15}/><span>Ваши задачи сохраняются локально. ИИ-агенты и внешние действия пока отключены.</span><span className="demo-label">MVP</span></div>
        {error && <div className="message error-message" role="alert"><span>{error}</span><Button variant="outline" onClick={()=>setRefresh(v=>v+1)} disabled={busy}><RefreshCw size={14}/>Обновить</Button></div>}
        {notice && <output className="message success-message"><Check size={16}/><span>{notice}</span><Button variant="ghost" size="icon" aria-label="Закрыть уведомление" onClick={()=>setNotice('')}><X size={14}/></Button></output>}
        {view==='overview' && <BalanceWheel tasks={tasks} loading={loading} onSelect={id=>{setView('tasks');setSphereFilter(id);setStatusFilter('all');setQuery('');}}/>}
        {view==='overview' && <form className="composer" onSubmit={submit}>
          <div className="composer-title"><span className="spark-icon"><Sparkles size={19}/></span><label htmlFor="task-input"><strong>Что нужно сделать?</strong></label><span className="form-hint">Новая задача попадёт в «Мои задачи»</span></div>
          <Textarea ref={draftRef} id="task-input" placeholder="Например, спланируй поездку в Лиссабон на выходные с бюджетом 600 €…" value={draft} maxLength={5000} required disabled={busy} onChange={e=>changeDraft(e.target.value)} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();e.currentTarget.form?.requestSubmit();}}}/>
          <div className="task-fields"><div className="field-label"><span>Сфера</span><NativeSelect value={sphere} disabled={busy} onChange={e=>{const id=e.target.value as SphereId;setSphere(id);setSubcategory(spheres.find(item=>item.id===id)?.subcategories[0]||'');requestId.current=null;}}>{spheres.map(item=><NativeSelectOption value={item.id} key={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect></div><div className="field-label"><span>Направление</span><NativeSelect value={subcategory} disabled={busy||!spheres.find(item=>item.id===sphere)?.subcategories.length} onChange={e=>{setSubcategory(e.target.value);requestId.current=null;}}><NativeSelectOption value="">Без направления</NativeSelectOption>{spheres.find(item=>item.id===sphere)?.subcategories.map(item=><NativeSelectOption key={item}>{item}</NativeSelectOption>)}</NativeSelect></div><label htmlFor="due-date">Выполнить до<Input id="due-date" type="date" value={dueDate} min={new Date().toISOString().slice(0,10)} required disabled={busy} onChange={e=>{setDueDate(e.target.value);requestId.current=null;}}/></label><label htmlFor="task-queue">Очередность<Input id="task-queue" type="number" min={1} max={999} value={queue} required disabled={busy} onChange={e=>{setQueue(Math.max(1,Number(e.target.value)||1));requestId.current=null;}}/></label><div className="field-label"><span>Приоритет</span><NativeSelect value={priority} disabled={busy} onChange={e=>{setPriority(e.target.value as Priority);requestId.current=null;}}>{priorities.map(item=><NativeSelectOption key={item} value={item}>{priorityLabels[item]}</NativeSelectOption>)}</NativeSelect></div></div><div className="composer-bottom"><div className="suggestions"><span>Ctrl + Enter — сохранить</span></div><Button type="submit" className="primary-button" disabled={!draft.trim()||!dueDate||busy}>{busy?<LoaderCircle className="spin" size={15}/>:<ArrowUp size={16}/>}Добавить задачу</Button></div>
        </form>}
        <section className="stats" aria-label="Сводка по задачам">{stats.map(s=><button className={`stat ${statusFilter===s.filter&&s.filter!=='all'?'selected-stat':''}`} key={s.label} onClick={()=>{setView('tasks');setStatusFilter(s.filter as Status|'all');setSphereFilter('all');setQuery('');}}><div className="stat-label"><span>{s.label}</span><s.icon size={17}/></div><div className="stat-value">{loading?'—':s.value}</div><small>{s.caption}</small></button>)}</section>
        <div className="content-grid"><section className="task-section" aria-label="Список задач">
          <div className="section-heading"><h2>{view==='approvals'?'Ожидают решения':'Мои задачи'} <span>{filtered.length}</span></h2><Button variant="ghost" onClick={()=>setRefresh(v=>v+1)} disabled={loading||busy} aria-label="Обновить задачи"><RefreshCw size={14} className={loading?'spin':''}/></Button></div>
          <div className="task-filters"><NativeSelect aria-label="Фильтр по статусу" size="sm" value={statusFilter} disabled={view==='approvals'} onChange={e=>setStatusFilter(e.target.value as Status|'all')}><NativeSelectOption value="all">Все статусы</NativeSelectOption>{Object.entries(statuses).map(([value,label])=><NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect><NativeSelect aria-label="Фильтр по сфере" size="sm" value={sphereFilter} onChange={e=>setSphereFilter(e.target.value)}><NativeSelectOption value="all">Все сферы</NativeSelectOption>{spheres.map(item=><NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect><div className="search-box"><Search size={15}/><Input aria-label="Поиск задач" placeholder="Найти задачу" value={query} onChange={e=>setQuery(e.target.value)}/></div></div>
          <div className="task-list" aria-busy={loading}>
            {loading && !tasks.length?<div className="empty-state"><LoaderCircle size={24} className="spin"/><h3>Загружаем пространство</h3><p>Получаем задачи из локальной базы.</p></div>:!filtered.length?<div className="empty-state"><ListTodo size={30}/><h3>{tasks.length?'Ничего не найдено':'Место для ваших планов'}</h3><p>{tasks.length?'Попробуйте изменить поиск или фильтры.':'Добавьте первую задачу обычными словами.'}</p><Button variant="outline" onClick={tasks.length?()=>navigate(view):newTask}>{tasks.length?'Сбросить фильтры':'Добавить задачу'}</Button></div>:filtered.map(task=>{const Icon=sphereIcons[task.sphere];const sphereInfo=spheres.find(item=>item.id===task.sphere)!;return <button className="task-row" key={task.id} onClick={()=>setSelected(task.id)}><span className={`task-icon ${task.status}`} style={{color:sphereInfo.color}}><Icon size={18}/></span><span className="queue-number">{task.queue}</span><div className="task-info"><strong>{task.title}</strong><small>{sphereInfo.name}{task.subcategory?` · ${task.subcategory}`:''} · Локально</small><div className="task-attributes"><span className={`priority ${task.priority}`}>{priorityLabels[task.priority]}</span><span>до {task.dueDate?new Date(`${task.dueDate}T00:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'short'}):'без срока'}</span></div></div><StatusPill status={task.status}/><ArrowUpRight size={16} className="row-arrow"/></button>;})}
          </div>
          <div className="list-footnote"><Clock3 size={12}/>Новые задачи ждут подключения OpenAI Agents SDK.</div>
        </section>
        <div className="right-column"><section className="approval-panel"><div className="section-heading"><h2><ShieldCheck size={18}/>На подтверждение</h2><span className="count">{approvals.length}</span></div>
          {approvals.length?approvals.map(task=><div className="approval-preview" key={task.id}><div className="approval-kicker">{spheres.find(item=>item.id===task.sphere)?.name.toUpperCase()}</div><h3>{task.proposal?.title}</h3><p>Предложение готово к просмотру. Ничего не будет отправлено без вашего решения.</p><Button className="review-button" onClick={()=>setSelected(task.id)}>Посмотреть предложение<ArrowUpRight size={15}/></Button></div>):<div className="clear-approvals"><ShieldCheck size={27}/><h3>Всё спокойно</h3><p>Нет предложений, ожидающих решения.</p></div>}
        </section><section className="agent-note"><span className="agent-note-icon"><Bot size={23}/></span><h3>Команда на вашей стороне</h3><p>Здесь появятся агенты для поиска, планирования и повседневных дел.</p><Button variant="ghost" onClick={()=>setInfo('agents')}>Как это будет работать<ArrowUpRight size={13}/></Button><div><span className="small-dot"/>OpenAI Agents SDK · следующий этап</div></section></div></div>
        <footer><ShieldCheck size={14}/>Ничего не отправляется и не бронируется автоматически.<span>ORBIT / PERSONAL OPERATING SPACE</span></footer>
      </main>
    </div>
    <Dialog open={!!selectedTask} onOpenChange={open=>{if(!open&&!busy)setSelected(null);}}><DialogContent className="task-dialog"><DialogHeader><div className="detail-kicker">{spheres.find(item=>item.id===selectedTask?.sphere)?.name}{selectedTask?.subcategory?` / ${selectedTask.subcategory}`:''} / МОЯ ЗАДАЧА</div><DialogTitle className="detail-title">{selectedTask?.title}</DialogTitle><DialogDescription>Задача, предложение и полная история действий.</DialogDescription></DialogHeader>
      {selectedTask&&<><div className="detail-meta"><StatusPill status={selectedTask.status}/><span className={`priority ${selectedTask.priority}`}>{priorityLabels[selectedTask.priority]}</span><span>Очередь №{selectedTask.queue}</span><span>Срок: {selectedTask.dueDate?new Date(`${selectedTask.dueDate}T00:00:00`).toLocaleDateString('ru-RU'):'не указан'}</span><span>Версия {selectedTask.revision}</span></div><section className="detail-section"><h3>Исходная задача</h3><p className="preserve-text">{selectedTask.description}</p></section>
      {selectedTask.proposal&&<section className="proposal-detail"><div className="section-heading"><h3>{selectedTask.proposal.title}</h3></div><dl><div><dt>Получатель</dt><dd>{selectedTask.proposal.recipient}</dd></div><div><dt>Стоимость</dt><dd>{selectedTask.proposal.cost}</dd></div></dl><p className="draft-body preserve-text">{selectedTask.proposal.body}</p><div className="proposal-warning"><ShieldCheck size={16}/><span>Одобрение записывает только ваше решение. Отправка, оплата и бронирование отключены.</span></div>
      {selectedTask.proposal.state==='pending'?<div className="decision-buttons"><Button variant="outline" disabled={busy||loading} onClick={()=>void act(selectedTask,{op:'decision',proposalId:selectedTask.proposal!.id,decision:'rejected'})}><X size={15}/>Отклонить</Button><Button className="primary-button" disabled={busy||loading} onClick={()=>void act(selectedTask,{op:'decision',proposalId:selectedTask.proposal!.id,decision:'approved'})}><Check size={15}/>Одобрить предложение</Button></div>:<div className="decision-record"><Check size={16}/>{selectedTask.proposal.state==='approved'?'Предложение одобрено':'Предложение отклонено'} · {date(selectedTask.proposal.decidedAt!)}</div>}
      </section>}
      {selectedTask.result&&<div className={`message ${selectedTask.status==='error'?'error-message':'success-message'}`}>{selectedTask.result}</div>}
      {error&&<div className="message error-message" role="alert">{error}<Button variant="outline" onClick={()=>setRefresh(v=>v+1)} disabled={busy}>Обновить</Button></div>}
      <section className="detail-section"><h3>История шагов</h3><ol className="timeline">{selectedTask.events.map(item=><li key={item.id}><span className="timeline-dot"/><div><div className="timeline-title"><strong>{item.title}</strong><time>{date(item.at)}</time></div><p>{item.detail}</p><small>{item.actor}</small></div></li>)}</ol></section>
      <div className="detail-actions">{selectedTask.status==='pending'&&<Button variant="outline" disabled={busy||loading} onClick={()=>void act(selectedTask,{op:'complete'})}><CheckCheck size={15}/>Завершить вручную</Button>}</div></>}
    </DialogContent></Dialog>
    <Dialog open={!!info} onOpenChange={open=>{if(!open)setInfo(null);}}><DialogContent className="info-dialog"><DialogHeader><DialogTitle>{info==='agents'?'Будущая команда агентов':'Orbit · локальный MVP'}</DialogTitle><DialogDescription>{info==='agents'?'План подключения через OpenAI Agents SDK. Эти агенты пока не работают.':'Что уже работает и где проходят границы прототипа.'}</DialogDescription></DialogHeader>{info==='agents'?<><div className="orchestrator"><Workflow size={21}/><div><strong>Главный оркестратор</strong><p>Принимает задачу, планирует шаги и ждёт ваших решений.</p></div></div><div className="agents-grid">{[{name:'Классификатор',description:'Определяет категорию и план',icon:ListTodo},{name:'Исследователь',description:'Ищет и сравнивает информацию',icon:Search},{name:'Планировщик',description:'Готовит маршруты и варианты',icon:Plane},{name:'Почтовый агент',description:'Подготавливает черновики писем',icon:Mail}].map(agent=><div key={agent.name}><agent.icon size={19}/><h3>{agent.name}</h3><p>{agent.description}</p><small>Не подключён</small></div>)}</div><p className="info-note">Следующий этап: Python-сервис с цепочкой «классификатор → исследователь → отчёт». Реальные действия подключаются только после серверной проверки подтверждения.</p></>:<div className="about-copy"><p><strong>Работает:</strong> создание задач, поиск, фильтры, ручное завершение, история действий и экспорт.</p><p><strong>Хранение:</strong> локальная SQLite-база через D1-эмулятор. Перезагрузка страницы не удаляет данные.</p><p><strong>Отключено:</strong> вызовы LLM, поиск в интернете, почта, платежи и бронирования. API-ключи не требуются.</p><p><strong>Безопасность:</strong> только этот компьютер. Авторизация для облака ещё не реализована — не публикуйте текущую версию и не открывайте доступ по сети.</p><p>Кнопка «Экспорт» сохраняет ваши задачи в JSON. Автоматический импорт пока не предусмотрен.</p></div>}</DialogContent></Dialog>
  </div>;
}

function BalanceWheel({tasks,loading,onSelect}:{tasks:Task[];loading:boolean;onSelect:(id:SphereId)=>void}) {
  const active = tasks.filter(task=>task.status!=='completed');
  return <section className="balance-panel"><div className="balance-copy"><p className="dashboard-label">КОЛЕСО БАЛАНСА</p><h2>Ваши сферы жизни</h2><p>Сразу видно, где собраны задачи и что требует внимания. Нажмите на сферу, чтобы открыть её список.</p><div className="balance-wheel" aria-label="Распределение задач по сферам"><div className="wheel-center"><strong>{loading?'—':active.length}</strong><span>активных<br/>задач</span></div></div></div><div className="sphere-grid">{spheres.map(sphere=>{const items=tasks.filter(task=>task.sphere===sphere.id);const open=items.filter(task=>task.status!=='completed');const urgent=open.filter(task=>task.priority==='critical'||task.priority==='high').length;const next=open.filter(task=>task.dueDate).sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)))[0];const Icon=sphereIcons[sphere.id];return <button key={sphere.id} className="sphere-card" style={{'--sphere-color':sphere.color} as React.CSSProperties} onClick={()=>onSelect(sphere.id)}><span className="sphere-icon"><Icon size={19}/></span><div><strong>{sphere.name}</strong><small>{open.length} активных{urgent?` · ${urgent} важных`:''}</small>{next&&<time>ближайший срок · {new Date(`${next.dueDate}T00:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}</time>}</div><span className="sphere-total">{items.length}</span></button>})}</div></section>;
}
