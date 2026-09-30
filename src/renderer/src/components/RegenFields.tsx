import SpellField from './SpellPicker';
import { NumberField } from './FormField';
import { t } from '../lib/i18n';
import type { SpellOption } from '@shared/ipc';
import type { RegenDraft } from '@shared/drafts';

export interface RegenFieldsProps {
  regen: RegenDraft;
  onChange(regen: RegenDraft): void;
  /** Spells castable on this character: each of these is cast bare, on yourself. */
  spells: readonly SpellOption[];
  namePrefix: string;
}

/**
 * MegaMUD's regen and when-full spells (`RegenConfig`), drawn by both settings
 * forms: the two regen spells and the tick that recasts mana regen, then the
 * two a full recovery earns.
 */
export default function RegenFields({
  regen,
  onChange,
  spells,
  namePrefix
}: RegenFieldsProps): React.JSX.Element {
  return (
    <div className="settings-cures">
      <SpellField
        hint={t('settings.spells.regenHpHint')}
        label={t('settings.spells.regenHpLabel')}
        name={`${namePrefix}-regen-hp`}
        onChange={(hp) => onChange({ ...regen, hp })}
        spells={spells}
        value={regen.hp}
      />
      <SpellField
        hint={t('settings.spells.regenManaHint')}
        label={t('settings.spells.regenManaLabel')}
        name={`${namePrefix}-regen-mana`}
        onChange={(mana) => onChange({ ...regen, mana })}
        spells={spells}
        value={regen.mana}
      />
      <NumberField
        hint={t('settings.spells.regenMinTickHint')}
        label={t('settings.spells.regenMinTickLabel')}
        name={`${namePrefix}-regen-min-tick`}
        onChange={(value) =>
          onChange({ ...regen, manaMinTick: Math.max(0, Number.parseInt(value, 10) || 0) })
        }
        value={String(regen.manaMinTick)}
      />
      <SpellField
        hint={t('settings.spells.regenHpFullHint')}
        label={t('settings.spells.regenHpFullLabel')}
        name={`${namePrefix}-regen-hp-full`}
        onChange={(hpFull) => onChange({ ...regen, hpFull })}
        spells={spells}
        value={regen.hpFull}
      />
      <SpellField
        hint={t('settings.spells.regenManaFullHint')}
        label={t('settings.spells.regenManaFullLabel')}
        name={`${namePrefix}-regen-mana-full`}
        onChange={(manaFull) => onChange({ ...regen, manaFull })}
        spells={spells}
        value={regen.manaFull}
      />
    </div>
  );
}
