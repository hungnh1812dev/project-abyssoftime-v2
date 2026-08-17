import { ConnectionOverlay } from "@/components/ConnectionOverlay";
import { useAuth } from "@/context/AuthContext";
import { useHealthStatus } from "@/context/HealthContext";

export function BootOverlay() {
  const { status } = useHealthStatus();
  const { loading } = useAuth();
  return <ConnectionOverlay visible={status !== "healthy" || loading} />;
}
