import { cn } from '@/lib/utils'
import type { IncidentSeverity, IncidentStatus, SentimentLabel } from '@/types'

const severityMap: Record<IncidentSeverity, string> = {
  critical: 'bg-violet-500/15    text-violet-400    border-violet-500/30',
  high:     'bg-orange-500/15 text-orange-400 border-orange-500/30',
  medium:   'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  low:      'bg-green-500/15  text-green-400  border-green-500/30',
}

const statusMap: Record<IncidentStatus, string> = {
  pending:     'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  in_progress: 'bg-blue-500/15   text-blue-400   border-blue-500/30',
  resolved:    'bg-green-500/15  text-green-400  border-green-500/30',
  closed:      'bg-surface-muted text-text-muted  border-surface-border',
}

const sentimentMap: Record<SentimentLabel, string> = {
  positive: 'bg-green-500/15  text-green-400  border-green-500/30',
  neutral:  'bg-blue-500/15   text-blue-400   border-blue-500/30',
  negative: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  joy:      'bg-green-500/15  text-green-400  border-green-500/30',
  sadness:  'bg-blue-500/15   text-blue-400   border-blue-500/30',
  anger:    'bg-orange-500/15 text-orange-400 border-orange-500/30',
  fear:     'bg-violet-500/15    text-violet-400    border-violet-500/30',
  disgust:  'bg-orange-500/15 text-orange-400 border-orange-500/30',
  surprise: 'bg-blue-500/15   text-blue-400   border-blue-500/30',
  panic:    'bg-violet-500/15    text-violet-400    border-violet-500/30',
}

interface BadgeProps {
  children: React.ReactNode
  variant?: 'severity' | 'status' | 'sentiment' | 'default'
  value?:   IncidentSeverity | IncidentStatus | SentimentLabel
  className?: string
}

export function Badge({ children, variant = 'default', value, className }: BadgeProps) {
  let cls = 'bg-surface-muted text-text-secondary border-surface-border'

  // Choose style based on semantic meaning.
  if (variant === 'severity' && value) cls = severityMap[value as IncidentSeverity]
  if (variant === 'status'   && value) cls = statusMap[value as IncidentStatus]
  if (variant === 'sentiment'&& value) cls = sentimentMap[value as SentimentLabel]

  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border capitalize', cls, className)}>
      {children}
    </span>
  )
}
