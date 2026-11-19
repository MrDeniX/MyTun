import React, { useState } from 'react';
import { Download, Share, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showModal, setShowModal] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowModal(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="h-8 px-2.5 rounded-lg bg-[#141414] border border-[#262626] hover:border-[#3F3F46] active:scale-[0.98] transition-all flex items-center gap-1.5 text-[11px] font-medium text-[#FAFAFA] whitespace-nowrap shrink-0 cursor-pointer"
        title="Установить приложение на главный экран"
      >
        <Download className="w-3.5 h-3.5 text-[#10B981]" />
        <span>PWA</span>
      </button>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-[#141414] border border-[#262626] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-[#262626]">
              <h3 className="text-base font-semibold text-[#FAFAFA]">
                Установка приложения TONE.01
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#8E8E93] hover:text-[#FAFAFA]"
                aria-label="Закрыть"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm text-[#A1A1AA] leading-relaxed">
              {isIOS ? (
                <>
                  <p>Чтобы установить тюнер на домашний экран iPhone / iPad для работы офлайн:</p>
                  <ol className="list-decimal list-inside space-y-2 text-[#FAFAFA]">
                    <li className="flex items-center gap-2">
                      <span>1. Нажмите кнопку</span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#1C1C1C] border border-[#262626] text-xs">
                        <Share className="w-3.5 h-3.5 text-[#10B981]" /> Поделиться
                      </span>
                      <span>в Safari.</span>
                    </li>
                    <li>2. Выберите пункт «На экран «Домой»».</li>
                  </ol>
                </>
              ) : (
                <>
                  <p>
                    Приложение поддерживает полную офлайн-работу через Service Worker.
                  </p>
                  <p className="text-[#FAFAFA]">
                    Откройте меню браузера (⋮) и выберите «Установить приложение» или «Добавить на главный экран».
                  </p>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="mt-6 w-full min-h-[48px] rounded-2xl bg-[#1C1C1C] border border-[#262626] text-sm font-medium text-[#FAFAFA] hover:bg-[#262626] transition-colors cursor-pointer"
            >
              Понятно
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const { isOnline, isNative } = usePWAInstall();

  if (isOnline || isNative) return null;

  return (
    <div className="fixed top-12 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-xl bg-[#141414]/95 border border-[#F59E0B]/40 px-3 py-1.5 text-xs font-medium text-[#F59E0B] shadow-lg backdrop-blur-md">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Автономный режим (Офлайн)</span>
    </div>
  );
};
