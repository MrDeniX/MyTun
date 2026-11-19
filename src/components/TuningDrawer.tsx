import React, { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Plus, Trash2, X } from 'lucide-react';
import {
  CHROMATIC_NOTES,
  GuitarString,
  NoteName,
  TuningPreset,
  calculateNoteFrequency,
  createGuitarString,
  shiftNoteBySemitones,
} from '../types/tuning';
import { formatStringsSubtitle } from '../services/tuningStorage';

interface TuningDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  presets: TuningPreset[];
  activePresetId: string;
  onSelectPreset: (presetId: string) => void;
  onSaveCustomPreset: (preset: TuningPreset) => void;
  onDeleteCustomPreset: (presetId: string) => void;
}

const DEFAULT_CUSTOM_STRINGS: GuitarString[] = [
  createGuitarString(6, 'E', 2),
  createGuitarString(5, 'A', 2),
  createGuitarString(4, 'D', 3),
  createGuitarString(3, 'G', 3),
  createGuitarString(2, 'B', 3),
  createGuitarString(1, 'E', 4),
];

export const TuningDrawer: React.FC<TuningDrawerProps> = ({
  isOpen,
  onClose,
  presets,
  activePresetId,
  onSelectPreset,
  onSaveCustomPreset,
  onDeleteCustomPreset,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customStrings, setCustomStrings] = useState<GuitarString[]>(DEFAULT_CUSTOM_STRINGS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const startCreatingFromCurrent = () => {
    const active = presets.find((p) => p.id === activePresetId);
    if (active) {
      setCustomStrings(active.strings.map((s) => ({ ...s })));
    } else {
      setCustomStrings(DEFAULT_CUSTOM_STRINGS.map((s) => ({ ...s })));
    }
    setCustomName('');
    setErrorMessage(null);
    setIsCreating(true);
  };

  const handleShiftString = (index: number, delta: number) => {
    setCustomStrings((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const shifted = shiftNoteBySemitones(item.note, item.octave, delta);
        return {
          ...item,
          note: shifted.note,
          octave: shifted.octave,
          frequency: shifted.frequency,
        };
      })
    );
  };

  const handleDirectNoteChange = (index: number, note: NoteName, octave: number) => {
    setCustomStrings((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        return {
          ...item,
          note,
          octave,
          frequency: calculateNoteFrequency(note, octave),
        };
      })
    );
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customName.trim();
    if (!trimmed) {
      setErrorMessage('Введите название строя');
      return;
    }

    const newPreset: TuningPreset = {
      id: `custom-${Date.now()}`,
      name: trimmed,
      subtitle: formatStringsSubtitle(customStrings),
      isCustom: true,
      strings: customStrings,
    };

    onSaveCustomPreset(newPreset);
    setIsCreating(false);
    setCustomName('');
    setErrorMessage(null);
  };

  const builtinPresets = presets.filter((p) => !p.isCustom);
  const customPresets = presets.filter((p) => p.isCustom);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[88vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-[#141414] border-t sm:border border-[#262626] shadow-2xl overflow-hidden pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag Handle */}
        <div className="w-10 h-1.5 bg-[#262626] rounded-full mx-auto mt-3 mb-1 shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#262626] shrink-0">
          <div>
            <h2 className="text-base font-semibold text-[#FAFAFA]">
              {isCreating ? 'Новый пользовательский строй' : 'Выбор гитарного строя'}
            </h2>
            <p className="text-xs text-[#8E8E93]">
              {isCreating
                ? 'Настройте ноту и октаву каждой из 6 струн'
                : 'Стандартные пресеты и сохраненные строи'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (isCreating) {
                setIsCreating(false);
              } else {
                onClose();
              }
            }}
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#8E8E93] hover:text-[#FAFAFA] transition-colors cursor-pointer"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {!isCreating ? (
            <>
              {/* Кнопка создания своего строя */}
              <button
                type="button"
                onClick={startCreatingFromCurrent}
                className="w-full min-h-[52px] px-4 py-3 rounded-2xl bg-[#1C1C1C] border border-[#262626] hover:border-[#10B981]/60 active:scale-[0.99] transition-all flex items-center justify-between text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#10B981]/15 border border-[#10B981]/30 flex items-center justify-center text-[#10B981]">
                    <Plus className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[#FAFAFA]">
                      Создать свой строй
                    </div>
                    <div className="text-xs text-[#8E8E93]">
                      Произвольные ноты и октавы для 6 струн
                    </div>
                  </div>
                </div>
              </button>

              {/* Пользовательские строи */}
              {customPresets.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-[#8E8E93] px-1">
                    Пользовательские строи
                  </div>
                  <div className="space-y-2">
                    {customPresets.map((preset) => {
                      const isSelected = preset.id === activePresetId;
                      return (
                        <div
                          key={preset.id}
                          className={`flex items-center justify-between rounded-2xl border transition-colors ${
                            isSelected
                              ? 'bg-[#10B981]/10 border-[#10B981]'
                              : 'bg-[#0A0A0A] border-[#262626] hover:border-[#3F3F46]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onSelectPreset(preset.id);
                              onClose();
                            }}
                            className="flex-1 min-h-[58px] px-4 py-3 text-left flex items-center justify-between cursor-pointer"
                          >
                            <div>
                              <div className="text-sm font-semibold text-[#FAFAFA]">
                                {preset.name}
                              </div>
                              <div className="text-xs font-mono tabular-nums text-[#8E8E93] mt-0.5">
                                {preset.subtitle}
                              </div>
                            </div>
                            {isSelected && (
                              <Check className="w-4 h-4 text-[#10B981] shrink-0 ml-2" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteCustomPreset(preset.id)}
                            className="min-h-[58px] min-w-[48px] px-3 flex items-center justify-center text-[#8E8E93] hover:text-[#EF4444] border-l border-[#262626] transition-colors cursor-pointer"
                            title="Удалить строй"
                            aria-label={`Удалить строй ${preset.name}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Встроенные пресеты */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-[#8E8E93] px-1">
                  Встроенные пресеты
                </div>
                <div className="space-y-2">
                  {builtinPresets.map((preset) => {
                    const isSelected = preset.id === activePresetId;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          onSelectPreset(preset.id);
                          onClose();
                        }}
                        className={`w-full min-h-[58px] px-4 py-3 rounded-2xl border text-left transition-all flex items-center justify-between cursor-pointer ${
                          isSelected
                            ? 'bg-[#10B981]/10 border-[#10B981]'
                            : 'bg-[#0A0A0A] border-[#262626] hover:border-[#3F3F46]'
                        }`}
                      >
                        <div>
                          <div className="text-sm font-semibold text-[#FAFAFA]">
                            {preset.name}
                          </div>
                          <div className="text-xs font-mono tabular-nums text-[#8E8E93] mt-0.5">
                            {preset.subtitle}
                          </div>
                        </div>
                        {isSelected && (
                          <Check className="w-4 h-4 text-[#10B981] shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <form onSubmit={handleSave} className="space-y-5">
              <div>
                <label
                  htmlFor="custom-tuning-name"
                  className="block text-xs font-medium text-[#8E8E93] mb-1.5"
                >
                  Название строя
                </label>
                <input
                  id="custom-tuning-name"
                  type="text"
                  value={customName}
                  onChange={(e) => {
                    setCustomName(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="Например: Open C / Math Rock"
                  maxLength={32}
                  className="w-full min-h-[48px] px-4 rounded-2xl bg-[#0A0A0A] border border-[#262626] focus:border-[#10B981] focus:outline-none text-sm text-[#FAFAFA] placeholder:text-[#52525B]"
                />
                {errorMessage && (
                  <p className="text-xs text-[#EF4444] mt-1.5">{errorMessage}</p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-[#8E8E93] px-1">
                  <span>Струна (6 — басовая, 1 — первая)</span>
                  <span>Нота · Октава · Частота</span>
                </div>

                <div className="space-y-2">
                  {customStrings.map((str, idx) => (
                    <div
                      key={str.stringNumber}
                      className="flex items-center justify-between gap-2 p-2.5 rounded-2xl bg-[#0A0A0A] border border-[#262626]"
                    >
                      <div className="flex items-center gap-2.5 pl-1">
                        <span className="w-7 h-7 rounded-lg bg-[#141414] border border-[#262626] font-mono tabular-nums text-xs font-semibold flex items-center justify-center text-[#FAFAFA]">
                          {str.stringNumber}
                        </span>
                        <span className="text-xs font-mono tabular-nums text-[#8E8E93]">
                          {str.frequency.toFixed(1)} Гц
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {/* Кнопка на полутон ниже */}
                        <button
                          type="button"
                          onClick={() => handleShiftString(idx, -1)}
                          className="min-h-[44px] min-w-[44px] rounded-xl bg-[#141414] border border-[#262626] hover:border-[#3F3F46] active:scale-95 flex items-center justify-center text-[#FAFAFA] cursor-pointer"
                          title="На полутон ниже"
                          aria-label={`Струна ${str.stringNumber} на полутон ниже`}
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>

                        {/* Селектор ноты */}
                        <select
                          aria-label={`Нота струны ${str.stringNumber}`}
                          value={str.note}
                          onChange={(e) =>
                            handleDirectNoteChange(
                              idx,
                              e.target.value as NoteName,
                              str.octave
                            )
                          }
                          className="min-h-[44px] px-2.5 rounded-xl bg-[#141414] border border-[#262626] font-mono tabular-nums text-sm font-semibold text-[#FAFAFA] focus:border-[#10B981] focus:outline-none cursor-pointer"
                        >
                          {CHROMATIC_NOTES.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>

                        {/* Селектор октавы */}
                        <select
                          aria-label={`Октава струны ${str.stringNumber}`}
                          value={str.octave}
                          onChange={(e) =>
                            handleDirectNoteChange(
                              idx,
                              str.note,
                              Number(e.target.value)
                            )
                          }
                          className="min-h-[44px] px-2 rounded-xl bg-[#141414] border border-[#262626] font-mono tabular-nums text-sm font-semibold text-[#10B981] focus:border-[#10B981] focus:outline-none cursor-pointer"
                        >
                          {[1, 2, 3, 4, 5].map((oct) => (
                            <option key={oct} value={oct}>
                              {oct}
                            </option>
                          ))}
                        </select>

                        {/* Кнопка на полутон выше */}
                        <button
                          type="button"
                          onClick={() => handleShiftString(idx, 1)}
                          className="min-h-[44px] min-w-[44px] rounded-xl bg-[#141414] border border-[#262626] hover:border-[#3F3F46] active:scale-95 flex items-center justify-center text-[#FAFAFA] cursor-pointer"
                          title="На полутон выше"
                          aria-label={`Струна ${str.stringNumber} на полутон выше`}
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="flex-1 min-h-[48px] rounded-2xl bg-[#0A0A0A] border border-[#262626] text-sm font-medium text-[#8E8E93] hover:text-[#FAFAFA] transition-colors cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="flex-1 min-h-[48px] rounded-2xl bg-[#10B981] text-[#0A0A0A] text-sm font-semibold hover:bg-[#059669] active:scale-[0.99] transition-all cursor-pointer"
                >
                  Сохранить строй
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
