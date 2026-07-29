import { spawn } from "node:child_process";

export interface NotificationSoundCommand {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

export function getNotificationSoundCommands(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): NotificationSoundCommand[] {
  if (!filePath) return [];

  if (platform === "darwin") {
    return [{ command: "afplay", args: [filePath] }];
  }

  if (platform === "win32") {
    const script = "$player = New-Object System.Media.SoundPlayer $env:QCODE_NOTIFICATION_SOUND; $player.PlaySync()";
    const env = { ...process.env, QCODE_NOTIFICATION_SOUND: filePath };
    return [
      { command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", script], env },
      { command: "pwsh.exe", args: ["-NoProfile", "-NonInteractive", "-Command", script], env },
    ];
  }

  if (platform === "linux") {
    return [
      { command: "paplay", args: [filePath] },
      { command: "aplay", args: [filePath] },
      { command: "ffplay", args: ["-nodisp", "-autoexit", "-loglevel", "quiet", filePath] },
    ];
  }

  return [];
}

export async function playNotificationSoundFile(filePath: string): Promise<boolean> {
  for (const soundCommand of getNotificationSoundCommands(filePath)) {
    if (await runSoundCommand(soundCommand)) return true;
  }
  return false;
}

function runSoundCommand(soundCommand: NotificationSoundCommand): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(soundCommand.command, soundCommand.args, {
      env: soundCommand.env,
      stdio: "ignore",
      windowsHide: true,
    });
    let settled = false;
    const finish = (played: boolean) => {
      if (settled) return;
      settled = true;
      resolve(played);
    };
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
  });
}
