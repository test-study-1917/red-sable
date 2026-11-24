<script lang="ts">
  interface Props {
    label: string;
    value: string;
    onChange: (next: string) => void;
    alignEnd?: boolean;
    upperBound?: boolean;
  }

  let { label, value, onChange, alignEnd = false, upperBound = false }: Props = $props();

  const hours = Array.from({ length: 24 }, (_, n) => String(n).padStart(2, '0'));
  const minutes = Array.from({ length: 60 }, (_, n) => String(n).padStart(2, '0'));
  const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
  const now = new Date();
  let viewYear = $state(now.getFullYear());
  let viewMonth = $state(now.getMonth());
  let chosenDay = $state<number | null>(null);
  let hour = $state('00');
  let minute = $state('00');
  let pickerOpen = $state(false);

  function calendarDays(year: number, month: number): number[] {
    const start = (new Date(year, month, 1).getDay() + 6) % 7;
    const count = new Date(year, month + 1, 0).getDate();
    return [
      ...Array.from({ length: start }, () => 0),
      ...Array.from({ length: count }, (_, n) => n + 1),
    ];
  }
  let days = $derived(calendarDays(viewYear, viewMonth));

  function openPicker(): void {
    if (pickerOpen) {
      pickerOpen = false;
      return;
    }
    const parsed = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (parsed) {
      viewYear = Number(parsed[1]);
      viewMonth = Number(parsed[2]) - 1;
      chosenDay = Number(parsed[3]);
      hour = parsed[4];
      minute = parsed[5];
    } else {
      const current = new Date();
      viewYear = current.getFullYear();
      viewMonth = current.getMonth();
      chosenDay = current.getDate();
      hour = upperBound ? '23' : '00';
      minute = upperBound ? '59' : '00';
    }
    pickerOpen = true;
  }

  function moveMonth(offset: number): void {
    const next = new Date(viewYear, viewMonth + offset, 1);
    viewYear = next.getFullYear();
    viewMonth = next.getMonth();
    chosenDay = null;
  }

  function commit(): void {
    if (chosenDay === null) return;
    const y = String(viewYear).padStart(4, '0');
    const m = String(viewMonth + 1).padStart(2, '0');
    const d = String(chosenDay).padStart(2, '0');
    onChange(`${y}-${m}-${d}T${hour}:${minute}`);
    pickerOpen = false;
  }

  function clearValue(): void {
    onChange('');
    pickerOpen = false;
  }
</script>

<div class="date-time-field">
  <button
    type="button"
    class="date-trigger"
    aria-label={`${label}：${value ? value.replace('T', ' ') : '选择日期与时间'}`}
    aria-expanded={pickerOpen}
    onclick={openPicker}
  >
    <span class="date-label">{label}</span>
    {#if value}
      <span class="date-value">{value.replace('T', ' ')}</span>
    {/if}
    <span aria-hidden="true">▦</span>
  </button>
  {#if pickerOpen}
    <div class="calendar-popover" class:align-end={alignEnd}>
      <div class="month-heading">
        <button type="button" aria-label="上个月" onclick={() => moveMonth(-1)}>‹</button>
        <strong>{viewYear} 年 {viewMonth + 1} 月</strong>
        <button type="button" aria-label="下个月" onclick={() => moveMonth(1)}>›</button>
      </div>
      <div class="calendar-days">
        {#each weekdays as weekday (weekday)}
          <span class="weekday">{weekday}</span>
        {/each}
        {#each days as day, index (index)}
          {#if day === 0}
            <span class="empty-day" aria-hidden="true"></span>
          {:else}
            <button
              type="button"
              class:chosen={chosenDay === day}
              aria-pressed={chosenDay === day}
              aria-label={`${viewYear}年${viewMonth + 1}月${day}日`}
              onclick={() => (chosenDay = day)}>{day}</button
            >
          {/if}
        {/each}
      </div>
      <div class="clock-controls">
        <label
          >小时
          <select bind:value={hour}>
            {#each hours as h (h)}<option value={h}>{h}</option>{/each}
          </select>
        </label>
        <span aria-hidden="true">:</span>
        <label
          >分钟
          <select bind:value={minute}>
            {#each minutes as m (m)}<option value={m}>{m}</option>{/each}
          </select>
        </label>
      </div>
      <div class="picker-actions">
        <button type="button" onclick={clearValue}>清除</button>
        <button type="button" onclick={() => (pickerOpen = false)}>取消</button>
        <button class="confirm" type="button" disabled={chosenDay === null} onclick={commit}
          >确定</button
        >
      </div>
    </div>
  {/if}
</div>

<style>
  .date-time-field {
    flex: 1 1 min(100%, 15rem);
    min-width: 0;
    position: relative;
  }

  button,
  select {
    color: inherit;
    font: inherit;
  }

  .date-trigger {
    align-items: center;
    background: var(--surface-var-container);
    border: var(--border-width) solid var(--surface-container-line);
    border-radius: var(--radius);
    cursor: pointer;
    display: flex;
    gap: var(--space-200);
    height: 100%;
    min-width: 0;
    padding: var(--space-200);
    text-align: start;
    width: 100%;
  }

  .date-trigger:hover,
  .date-trigger[aria-expanded='true'] {
    background: var(--surface-var-container-hover);
  }

  .date-trigger[aria-expanded='true'] {
    border-color: var(--primary-main);
  }

  .date-trigger:active {
    background: var(--surface-var-container-active);
  }

  .date-label {
    flex-shrink: 0;
    white-space: nowrap;
  }

  .date-value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .date-trigger > [aria-hidden] {
    margin-inline-start: auto;
  }

  .calendar-popover {
    background: var(--surface-container);
    border: var(--border-width) solid var(--surface-container-line);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px color-mix(in srgb, var(--surface-on-container) 17%, transparent);
    box-sizing: border-box;
    inset-inline-start: 0;
    padding: var(--space-300);
    position: absolute;
    top: calc(100% + var(--space-100));
    width: min(21rem, calc(100vw - 2 * var(--space-300)));
    z-index: 5;
  }

  .calendar-popover.align-end {
    inset-inline: auto 0;
  }

  .month-heading {
    align-items: center;
    display: flex;
    gap: var(--space-200);
    justify-content: space-between;
  }

  .month-heading button {
    background: transparent;
    border: 0;
    cursor: pointer;
    padding: var(--space-100) var(--space-200);
  }

  .calendar-days {
    display: grid;
    gap: var(--space-100);
    grid-template-columns: repeat(7, minmax(0, 1fr));
    margin-top: var(--space-200);
  }

  .weekday,
  .empty-day {
    display: grid;
    min-height: 1.8rem;
    place-items: center;
  }

  .weekday {
    font-size: var(--font-size-small);
    opacity: 0.7;
  }

  .calendar-days button {
    background: transparent;
    border: 0;
    border-radius: var(--radius);
    cursor: pointer;
    display: grid;
    min-height: 1.8rem;
    min-width: 0;
    place-items: center;
  }

  .clock-controls {
    align-items: flex-end;
    display: flex;
    gap: var(--space-100);
    justify-content: center;
    margin-top: var(--space-200);
  }

  .clock-controls label {
    display: grid;
    font-size: var(--font-size-small);
    gap: var(--space-100);
  }

  .clock-controls select {
    background: var(--surface-var-container);
    border: var(--border-width) solid var(--surface-container-line);
    border-radius: var(--radius);
    padding: var(--space-100) var(--space-200);
  }

  .picker-actions {
    display: flex;
    gap: var(--space-100);
    justify-content: flex-end;
    margin-top: var(--space-200);
  }

  .picker-actions button {
    background: var(--surface-var-container);
    border: var(--border-width) solid var(--surface-container-line);
    border-radius: var(--radius);
    cursor: pointer;
    padding: var(--space-100) var(--space-200);
  }

  .calendar-days button:hover {
    background: var(--surface-var-container);
  }

  .calendar-days button.chosen {
    background: var(--primary-container);
    color: var(--primary-on-container);
  }

  .picker-actions .confirm {
    background: var(--primary-container);
    color: var(--primary-on-container);
  }

  .picker-actions button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  @media (width <= 36rem) {
    .date-trigger {
      align-content: center;
      box-sizing: border-box;
      display: grid;
      font-size: var(--font-size-small);
      gap: var(--space-050) var(--space-100);
      grid-template-columns: minmax(0, 1fr) auto;
      min-height: 3.25rem;
      padding-block: var(--space-100);
    }

    .date-value {
      font-size: var(--font-size-label);
      grid-column: 1 / -1;
      grid-row: 2;
    }

    .date-trigger > [aria-hidden] {
      grid-column: 2;
      grid-row: 1;
    }

    .calendar-popover,
    .calendar-popover.align-end {
      inset: 50% auto auto 50%;
      max-height: calc(100dvh - 2 * var(--space-300));
      overflow-y: auto;
      position: fixed;
      translate: -50% -50%;
    }
  }
</style>
