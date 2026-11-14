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
  let hour = $state(upperBound ? '23' : '00');
  let minute = $state(upperBound ? '59' : '00');
  let pickerOpen = $state(false);

  function calendarDays(year: number, month: number): number[] {
    const start = (new Date(year, month, 1).getDay() + 6) % 7;
    const count = new Date(year, month + 1, 0).getDate();
    return [...Array.from({ length: start }, () => 0), ...Array.from({ length: count }, (_, n) => n + 1)];
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
  <span class="field-label">{label}</span>
  <button type="button" class="date-trigger" aria-expanded={pickerOpen} onclick={openPicker}>
    <span>{value ? value.replace('T', ' ') : '选择日期与时间'}</span>
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
              onclick={() => (chosenDay = day)}
            >{day}</button>
          {/if}
        {/each}
      </div>
      <div class="clock-controls">
        <label>小时
          <select bind:value={hour}>
            {#each hours as h (h)}<option value={h}>{h}</option>{/each}
          </select>
        </label>
        <span aria-hidden="true">:</span>
        <label>分钟
          <select bind:value={minute}>
            {#each minutes as m (m)}<option value={m}>{m}</option>{/each}
          </select>
        </label>
      </div>
      <div class="picker-actions">
        <button type="button" onclick={clearValue}>清除</button>
        <button type="button" onclick={() => (pickerOpen = false)}>取消</button>
        <button class="confirm" type="button" disabled={chosenDay === null} onclick={commit}>确定</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .date-time-field { position: relative; display: grid; gap: var(--space-100); min-width: 0; }
  .field-label { color: var(--surface-on-container); font-size: var(--font-size-small); }
  button, select { color: inherit; font: inherit; }
  .date-trigger {
    display: flex; align-items: center; justify-content: space-between; gap: var(--space-200);
    width: 100%; min-width: 0; text-align: left; padding: var(--space-200);
    border: var(--border-width) solid var(--surface-container-line); border-radius: var(--radius);
    background: var(--surface-var-container); cursor: pointer;
  }
  .date-trigger span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .calendar-popover {
    position: absolute; top: calc(100% + var(--space-100)); left: 0; z-index: 5;
    width: min(21rem, calc(100vw - 2 * var(--space-300)));
    box-sizing: border-box; padding: var(--space-300);
    background: var(--surface-container); border: var(--border-width) solid var(--surface-container-line);
    border-radius: var(--radius); box-shadow: 0 8px 24px color-mix(in srgb, var(--surface-on-container) 17%, transparent);
  }
  .calendar-popover.align-end { right: 0; left: auto; }
  .month-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-200); }
  .month-heading button { border: 0; padding: var(--space-100) var(--space-200); background: transparent; cursor: pointer; }
  .calendar-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: var(--space-100); margin-top: var(--space-200); }
  .weekday, .empty-day { display: grid; place-items: center; min-height: 1.8rem; }
  .weekday { font-size: var(--font-size-small); opacity: .7; }
  .calendar-days button {
    display: grid; place-items: center; min-width: 0; min-height: 1.8rem;
    border: 0; border-radius: var(--radius); background: transparent; cursor: pointer;
  }
  .calendar-days button:hover { background: var(--surface-var-container); }
  .calendar-days button.chosen { background: var(--primary-container); color: var(--primary-on-container); }
  .clock-controls { display: flex; justify-content: center; align-items: flex-end; gap: var(--space-100); margin-top: var(--space-200); }
  .clock-controls label { display: grid; gap: var(--space-100); font-size: var(--font-size-small); }
  .clock-controls select {
    background: var(--surface-var-container); border: var(--border-width) solid var(--surface-container-line);
    border-radius: var(--radius); padding: var(--space-100) var(--space-200);
  }
  .picker-actions { display: flex; gap: var(--space-100); justify-content: flex-end; margin-top: var(--space-200); }
  .picker-actions button {
    border: var(--border-width) solid var(--surface-container-line); border-radius: var(--radius);
    padding: var(--space-100) var(--space-200); background: var(--surface-var-container); cursor: pointer;
  }
  .picker-actions .confirm { background: var(--primary-container); color: var(--primary-on-container); }
  .picker-actions button:disabled { opacity: .5; cursor: not-allowed; }
</style>
