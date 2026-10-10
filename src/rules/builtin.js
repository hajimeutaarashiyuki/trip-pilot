// 內建規則清單。加一條規則＝新增一個檔、在這裡多一行；刪一條＝反過來。順序不影響結果（硬約束取最嚴、軟約束相加）。
import dimWalk from './dim-walk.js';
import dimWalkRun from './dim-walk-run.js';
import dimShopRun from './dim-shop-run.js';
import dimCatCount from './dim-cat-count.js';
import dimRecRun from './dim-rec-run.js';
import dimAfternoon from './dim-afternoon.js';
import hours from './hours.js';
import fixedWindow from './fixed-window.js';
import windowRule from './window.js';
import maxStops from './max-stops.js';
import sameTypeDay from './same-type-day.js';
import earlyDay from './early-day.js';
import daylight from './daylight.js';
import walkBudget from './walk-budget.js';
import walkRun from './walk-run.js';
import shopRun from './shop-run.js';
import cafeAdjacent from './cafe-adjacent.js';
import recoveryRun from './recovery-run.js';
import backtrack from './backtrack.js';
import zoneExit from './zone-exit.js';
import noonUrban from './noon-urban.js';
import waitAtDoor from './wait-at-door.js';
import anchor from './anchor.js';
import designated from './designated.js';
import itemGap from './item-gap.js';
import mealSlots from './meal-slots.js';
import nightSlot from './night-slot.js';

export const BUILTIN = Object.freeze([
  // 累積量
  dimWalk, dimWalkRun, dimShopRun, dimCatCount, dimRecRun, dimAfternoon,
  // 硬約束（站）
  hours, fixedWindow, windowRule, maxStops, sameTypeDay, earlyDay, daylight,
  // 軟約束（站）
  walkBudget, walkRun, shopRun, cafeAdjacent, recoveryRun, backtrack, zoneExit, noonUrban, waitAtDoor,
  // 整天
  anchor, designated, itemGap, mealSlots, nightSlot,
]);
