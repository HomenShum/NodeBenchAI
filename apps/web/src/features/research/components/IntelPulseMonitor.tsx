import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Activity, Server, Database } from 'lucide-react';
import { useMotionConfig } from '@/lib/motion';

interface IntelPulseMonitorProps {
    taskResults: any[];
}

export function IntelPulseMonitor({ taskResults }: IntelPulseMonitorProps) {
    const { instant } = useMotionConfig();
    const enabled =
        import.meta.env.DEV &&
        typeof window !== 'undefined' &&
        (localStorage.getItem('nodebench_show_intel_pulse_monitor') === 'true' ||
            new URLSearchParams(window.location.search).get('intelPulse') === '1');

    if (!enabled) return null;
    if (!taskResults || taskResults.length === 0) return null;

    // Take last 5 results for the stream
    const activeResults = [...taskResults].reverse().slice(0, 5);

    return (
        <motion.div
            initial={{ y: instant ? 0 : 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="fixed bottom-0 left-0 right-0 h-10 bg-surface/80  border-t border-edge z-[30] flex items-center px-12 overflow-hidden pointer-events-none group/monitor"
        >
            <div className="flex items-center gap-4 shrink-0 pr-8 border-r border-edge mr-8">
                <Activity className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                <span className="text-xs font-bold text-content">Live Intelligence Flow</span>
            </div>

            <div className="flex-1 flex items-center gap-12 overflow-hidden whitespace-nowrap">
                {activeResults.map((res: any, idx: number) => (
                    <motion.div
                        key={res._id || idx}
                        initial={{ opacity: 0, x: instant ? 0 : 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-3"
                    >
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 motion-safe:animate-pulse" />
                        <span className="text-xs font-mono text-content-muted">
                            {res.taskName || 'Analysis Event'}
                        </span>
                        <span className="text-xs font-mono text-content font-bold">
                            {res.status?.toUpperCase() || 'SUCCESS'}
                        </span>
                        <span className="text-xs italic text-gray-300">
                            {res.output?.slice(0, 40)}...
                        </span>
                    </motion.div>
                ))}
            </div>

            <div className="flex items-center gap-6 shrink-0 pl-8 border-l border-edge ml-8 text-xs font-mono text-content-muted">
                <span>Nodes: 142</span>
                <span>Sec: E2EE</span>
                <div className="flex items-center gap-2">
                    <Server className="w-3 h-3 text-gray-300" />
                    <span className="group-hover/monitor:text-content dark:group-hover/monitor:text-gray-100 transition-colors">VAULT_01</span>
                </div>
            </div>
        </motion.div>
    );
}
