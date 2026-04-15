import { useState, useEffect, useRef, useCallback } from 'react';
import { startPlatformLogin, subscribePlatformLogin, cancelPlatformLogin } from '../api.js';
import { useI18n } from '../hooks/useI18n.js';

interface LoginModalProps {
  /** Platform to login to (e.g. 'zhihu', 'weibo', 'xiaohongshu') */
  platform: string;
  /** 1-based index of this platform in the queue */
  index: number;
  total: number;
  onSuccess: () => void;
  onSkip: () => void;
}

type Phase = 'starting' | 'qr_ready' | 'success' | 'error';

export function LoginModal({ platform, index, total, onSuccess, onSkip }: LoginModalProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('starting');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [refreshCount, setRefreshCount] = useState(0);
  const loginIdRef = useRef<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start (or restart) login session
  useEffect(() => {
    let alive = true;
    setPhase('starting');
    setQrDataUrl(null);
    setErrorMsg(null);
    setSecondsLeft(60);

    startPlatformLogin(platform)
      .then(({ loginId }) => {
        if (!alive) return;
        loginIdRef.current = loginId;

        const unsub = subscribePlatformLogin(loginId, {
          onQrReady: (url) => {
            if (!alive) return;
            setQrDataUrl(url);
            setPhase('qr_ready');
            setSecondsLeft(60);
          },
          onSuccess: () => {
            if (!alive) return;
            setPhase('success');
            setTimeout(onSuccess, 1500);
          },
          onError: (msg) => {
            if (!alive) return;
            setErrorMsg(msg);
            setPhase('error');
          },
        });
        cleanupRef.current = unsub;
      })
      .catch((err) => {
        if (!alive) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setPhase('error');
      });

    return () => {
      alive = false;
      cleanupRef.current?.();
      if (loginIdRef.current) {
        cancelPlatformLogin(loginIdRef.current).catch(() => {});
        loginIdRef.current = null;
      }
    };
  }, [platform, refreshCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = useCallback(() => {
    setRefreshCount(c => c + 1);
  }, []);

  // 60s countdown once QR is visible
  useEffect(() => {
    if (phase !== 'qr_ready') {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    timerRef.current = setInterval(() => {
      setSecondsLeft(s => Math.max(0, s - 1));
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  const handleSkip = async () => {
    cleanupRef.current?.();
    const id = loginIdRef.current;
    loginIdRef.current = null;
    if (id) await cancelPlatformLogin(id).catch(() => {});
    onSkip();
  };

  const PLATFORM_DISPLAY: Record<string, string> = {
    zhihu: '知乎',
    weibo: '微博',
    xiaohongshu: '小红书',
  };
  const displayName = PLATFORM_DISPLAY[platform] ?? platform;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal card */}
      <div className="relative bg-surface border border-border rounded-lg p-6 w-full max-w-sm shadow-xl animate-fade-in">
        {/* Header */}
        <div className="mb-4">
          <h3 className="text-base font-semibold text-text">
            {t('login.title') || '登录'} {displayName}
          </h3>
          {total > 1 && (
            <p className="text-xs text-text-secondary mt-1">
              {index} / {total} {t('login.platformsNeedLogin') || '个平台需要登录'}
            </p>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-col items-center gap-4 py-2">
          {phase === 'starting' && (
            <div className="py-8 flex flex-col items-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
              <p className="text-sm text-text-secondary">{t('login.starting') || '正在启动登录...'}</p>
            </div>
          )}

          {phase === 'qr_ready' && qrDataUrl && (
            <>
              <div className={`border-2 rounded-md p-2 ${secondsLeft < 15 ? 'border-warning/60' : 'border-border'} transition-colors`}>
                <img src={qrDataUrl} alt="QR Code" className="w-48 h-48" />
              </div>
              <p className="text-sm text-text-secondary text-center">
                {t('login.scanInstruction') || `使用 ${displayName} App 扫一扫登录`}
              </p>
              {secondsLeft > 0 ? (
                <p className={`text-xs font-mono ${secondsLeft < 15 ? 'text-warning' : 'text-accent'}`}>
                  {t('login.expiresIn') || '有效期'}：{secondsLeft}s
                </p>
              ) : (
                <button
                  onClick={handleRefresh}
                  className="text-xs text-accent hover:text-accent/80 underline transition"
                >
                  {t('login.refreshQr') || '二维码已过期，点击刷新'}
                </button>
              )}
            </>
          )}

          {phase === 'success' && (
            <div className="py-6 flex flex-col items-center gap-3">
              <div className="text-5xl text-success">✓</div>
              <p className="text-sm text-text-secondary">{displayName} {t('login.success') || '登录成功'}</p>
            </div>
          )}

          {phase === 'error' && (
            <div className="py-4 flex flex-col items-center gap-3 w-full">
              <p className="text-sm text-red-400 text-center break-words">{errorMsg}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {phase !== 'success' && (
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={handleSkip}
              className="px-3 py-1.5 text-sm text-text-secondary border border-border rounded-md hover:bg-surface-hover transition"
            >
              {t('login.skip') || '跳过'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
