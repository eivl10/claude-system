# Design Library — Admin Panel / Dashboard UI

Источник: "партнерский кабинет 4" (React/JSX admin панель). Паттерны, доведённые до финального вида через несколько итераций (`DONE.md`, `WORK_PLAN.md`, `FIXES.md`) — не первая попытка, а то, что реально устоялось.

## 1. Date-range picker (диапазон дат в фильтрах)

```jsx
<div className="date-range-wrapper">
  <Calendar size={18} color="var(--ink-soft)" />
  <DatePicker className="custom-datepicker" placeholderText="Начало" selectsStart ... />
  <span style={{ color: 'var(--ink-soft)', fontWeight: '600' }}>—</span>
  <DatePicker className="custom-datepicker" placeholderText="Конец" selectsEnd ... />
</div>
```
Иконка календаря внутри wrapper, не снаружи. Тире между полями — через `<span>` с `var(--ink-soft)`, не дефис в plain-тексте.

## 2. DatePicker внутри drawer (боковой панели)

```jsx
<div style={{ border: '1.5px solid #E0E3EA', borderRadius: '10px', padding: '10px 14px', background: 'white' }}>
  <DatePicker className="custom-datepicker" popperPlacement="bottom-start" withPortal wrapperClassName="..." />
</div>
```
`withPortal` обязателен внутри drawer — иначе календарь обрезается overflow-контейнером. `popperPlacement="bottom-start"` — открывается вниз, не наружу панели.

## 3. Чекбокс-фильтр ("Только активные" и т.п.)

```jsx
<label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px',
  color: 'var(--ink-soft)', cursor: 'pointer', userSelect: 'none' }}>
  <input type="checkbox" checked={onlyActive} onChange={...}
    style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} />
  Только активные
</label>
```
`accentColor: var(--accent)` — чекбокс красится в фирменный цвet без кастомной SVG-замены нативного инпута.

## 4. Единые CSS-переменные

Вся палитра идёт через переменные, не хардкод хексов в JSX:
- `var(--ink-soft)` — вторичный текст/иконки (лейблы, разделители).
- `var(--accent)` — фирменный акцентный цвет (чекбоксы, активные состояния).
- Граница инпутов — фиксированный хекс `#E0E3EA` (не переменная — специально, единственное место, см. `FIXES.md: index.css, AdminPartners.jsx — вид полей дат в drawer`).

## 5. Правило: drawer не трогать структурно

Из `TZ_EMAIL_SETTINGS_UI.md`: при добавлении новых полей в drawer партнёра — расширять существующую структуру, не перестраивать layout. Устоявшийся drawer-паттерн (шапка → поля → футер с действиями) — не место для экспериментов при точечных доработках.

## Как искать больше

Это только 5 паттернов, устоявшихся к моменту написания. Полный список решений и правок — `FIXES.md` в самом проекте (`local/4-d6370e86`, cross-project группа `experience-log`) и `WORK_PLAN.md`/`DONE.md` — там же история "почему стало так, а не иначе".
