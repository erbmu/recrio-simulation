import { Clock, AlertTriangle, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CameraProctoring } from "./CameraProctoring";

interface Channel {
  id: string;
  name: string;
  unread?: number;
  locked?: boolean;
}

interface SidebarProps {
  channels: Channel[];
  activeChannel: string;
  onChannelSelect: (channelId: string) => void;
  timeRemaining: string;
  violations: number;
  onViolation: (type: string) => void;
  simulationId: string;
}

export const Sidebar = ({
  channels,
  activeChannel,
  onChannelSelect,
  timeRemaining,
  violations,
  onViolation,
  simulationId,
}: SidebarProps) => {
  return (
    <div className="w-72 bg-recrio-sidebar text-white flex flex-col h-screen">
      {/* Header */}
      <div className="p-6 border-b border-white/10">
        <h1 className="text-2xl font-bold">Recrio</h1>
        <p className="text-xs text-white/60 mt-1 uppercase tracking-wider">Simulation</p>
      </div>

      {/* Timer & Violations (sticky + z-index to keep visible on zoom/overlap) */}
      <div className="sticky top-0 z-30 px-4 py-3 space-y-2 border-b border-white/10 bg-recrio-sidebar">
        <div className="flex items-center gap-2 text-sm">
          <Clock className="w-4 h-4 text-accent" />
          <span className="text-white/80">Time Remaining</span>
        </div>
        <div className="text-2xl font-bold tabular-nums">{timeRemaining}</div>
        
        <div className="flex items-center gap-2 text-sm pt-2">
          <AlertTriangle className="w-4 h-4 text-badge-danger" />
          <span className="text-white/80">Violations: {violations}</span>
        </div>
      </div>

      {/* Channels */}
      <div className="flex-1 overflow-y-auto py-4">
        <div className="px-4 mb-2">
          <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            Channels
          </h2>
        </div>
        <div className="space-y-1">
          {channels.map((channel) => (
            <button
              key={channel.id}
              onClick={() => !channel.locked && onChannelSelect(channel.id)}
              disabled={channel.locked}
              className={cn(
                "w-full px-4 py-2 flex items-center justify-between group transition-colors",
                activeChannel === channel.id
                  ? "bg-recrio-sidebar-active text-white"
                  : "hover:bg-recrio-sidebar-hover text-white/70",
                channel.locked && "opacity-50 cursor-not-allowed"
              )}
            >
              <span className="flex items-center gap-2">
                <span className="text-white/50">#</span>
                <span className="text-sm font-medium">{channel.name}</span>
                {channel.locked && <Lock className="w-3 h-3" />}
              </span>
              {channel.unread && channel.unread > 0 && (
                <Badge className="bg-badge-danger text-white border-0 h-5 px-1.5 min-w-5">
                  {channel.unread}
                </Badge>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Camera Proctoring */}
      <div className="p-4 border-t border-white/10">
        <CameraProctoring onViolation={onViolation} simulationId={simulationId} />
      </div>
    </div>
  );
};
