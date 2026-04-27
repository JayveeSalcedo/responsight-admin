import { cn } from '@/lib/utils'

interface StatCardProps {
  title:   string
  value:   string | number
  delta?:  string
  up?:     boolean
  icon:    React.ReactNode
  accent?: 'purple' | 'orange' | 'green' | 'blue' | 'yellow'
}

const accents = {
  purple: 'bg-brand-600/10 border-brand-600/20 text-brand-400',
  orange: 'bg-orange-500/10 border-orange-500/20 text-orange-400',
  green:  'bg-green-500/10  border-green-500/20  text-green-400',
  blue:   'bg-blue-500/10   border-blue-500/20   text-blue-400',
  yellow: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400',
}

export function StatCard({ title, value, delta, up, icon, accent = 'purple' }: StatCardProps) {
  return (
    <div className="glass rounded-xl p-5 animate-slide-up cursor-pointer transition-all hover:border-brand-400/50 hover:shadow-lg hover:shadow-brand-500/10 group">
      <div className="flex items-start justify-between mb-4">
        <div className={cn('w-10 h-10 rounded-lg border flex items-center justify-center transition-colors group-hover:text-brand-300', accents[accent])}>
          {icon}
        </div>
        {delta && (
          <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', up ? 'text-green-400 bg-green-400/10' : 'text-brand-400 bg-brand-400/10')}>
            {delta}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-text-primary">{value}</p>
      <p className="text-xs text-text-secondary mt-0.5">{title}</p>
    </div>
  )
}
