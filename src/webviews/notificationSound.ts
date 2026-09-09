export interface NotificationSoundOptions {
  assistantSoundEnabled?: boolean;
  assistantSoundUri?: string;
  cspSource?: string;
}

/** Shared by every route so remote/native-player fallbacks aren't detail-only. */
export function renderNotificationSoundScript(
  nonce: string,
  options: NotificationSoundOptions,
): string {
  return `<script nonce="${nonce}">
    (() => {
      let enabled = ${options.assistantSoundEnabled === true};
      let soundUri = ${JSON.stringify(options.assistantSoundUri ?? "").replace(/</g, "\\u003c")};
      let audioContext = null;
      let audioBufferPromise = null;
      const getAudioContext = () => {
        if (!enabled || !soundUri) return null;
        if (audioContext) return audioContext;
        const Constructor = window.AudioContext || window.webkitAudioContext;
        if (!Constructor) return null;
        audioContext = new Constructor();
        return audioContext;
      };
      const loadAudioBuffer = () => {
        const context = getAudioContext();
        if (!context) return Promise.resolve(null);
        if (!audioBufferPromise) {
          audioBufferPromise = fetch(soundUri)
            .then((response) => {
              if (!response.ok) throw new Error('Unable to load notification sound.');
              return response.arrayBuffer();
            })
            .then((buffer) => context.decodeAudioData(buffer))
            .catch(() => null);
        }
        return audioBufferPromise;
      };
      const unlockAudio = () => {
        const context = getAudioContext();
        if (!context) return;
        if (context.state === 'suspended') context.resume().catch(() => {});
        void loadAudioBuffer();
      };
      const playNotificationSoundInWebview = async () => {
        try {
          const context = getAudioContext();
          if (!context) return;
          if (context.state === 'suspended') await context.resume();
          const buffer = await loadAudioBuffer();
          if (!buffer) return;
          const source = context.createBufferSource();
          const gain = context.createGain();
          source.buffer = buffer;
          gain.gain.value = 0.8;
          source.connect(gain);
          gain.connect(context.destination);
          source.start();
        } catch {
          // Audio failures must not affect the rest of the UI.
        }
      };
      ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
        window.addEventListener(eventName, unlockAudio, { once: true, passive: true });
      });
      window.addEventListener('message', (event) => {
        if (event.data?.command === 'settingsSaved' && event.data.notificationSoundOptions) {
          const options = event.data.notificationSoundOptions;
          enabled = options.assistantSoundEnabled === true;
          soundUri = String(options.assistantSoundUri || '');
          audioBufferPromise = null;
        }
        if (event.data?.command === 'playNotificationSoundFallback') {
          void playNotificationSoundInWebview();
        }
      });
    })();
  </script>`;
}
