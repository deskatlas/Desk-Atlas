export { SectionTitle } from './components/SectionTitle';
export type { SectionTitleProps } from './components/SectionTitle';
export { StatusBadge } from './components/StatusBadge';
export type { StatusBadgeProps } from './components/StatusBadge';
export { PasswordRequirementsChecklist } from './components/PasswordRequirementsChecklist';
export type { PasswordRequirementsChecklistProps } from './components/PasswordRequirementsChecklist';
export { AppShell } from './layout/AppShell';
export type { AppShellProps } from './layout/AppShell';
export { SearchProvider, useSearch } from './components/SearchContext';
export type { SearchContextType, SearchProviderProps } from './components/SearchContext';
export { NumericInput, handleNumericKeyDown, parseNumericInput } from './components/NumericInput';
export type { NumericInputProps, NumericInputKeyOptions } from './components/NumericInput';
export { PasswordInput } from './components/PasswordInput';
export type { PasswordInputProps } from './components/PasswordInput';
export { ProfileDropdown } from './components/ProfileDropdown';
export type { ProfileDropdownProps, ProfileUser } from './components/ProfileDropdown';
export { DeactivatedAccountModal } from './components/DeactivatedAccountModal';
export type { DeactivatedAccountModalProps } from './components/DeactivatedAccountModal';
export { WorkspaceCountdownBadge } from './components/WorkspaceCountdownBadge';
export type { WorkspaceCountdownBadgeProps } from './components/WorkspaceCountdownBadge';
export {
  useLiveCountdownClock,
  useRemainingTime,
  formatRemainingDuration,
} from './hooks/useLiveCountdownClock';
export type {
  CountdownUrgency,
  FormattedRemainingDuration,
} from './hooks/useLiveCountdownClock';
export const appShellClassName = 'min-h-screen bg-slate-950 text-slate-100';


