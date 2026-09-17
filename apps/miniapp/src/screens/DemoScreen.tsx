import { CellList, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState, type ReactNode } from 'react';

import { describeFailure, type DemoRoleView, type DomovoyApi } from '../api.js';
import { useToast } from '../toast.js';
import { Failure } from './Failure.js';
import { IconBuildings, IconCheck, IconPerson, IconQueue, IconWrench } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface DemoScreenProps {
  api: DomovoyApi;
  /** Роль сменилась: сессию и разделы нужно перечитать. */
  onSwitched: () => void;
}

const LOOKS: Readonly<Record<string, { icon: () => ReactNode; tone: string }>> = {
  resident: { icon: IconPerson, tone: 'tile-blue' },
  dispatcher: { icon: IconQueue, tone: 'tile-red' },
  technician: { icon: IconWrench, tone: 'tile-teal' },
  manager: { icon: IconBuildings, tone: 'tile-green' },
  contractor: { icon: IconWrench, tone: 'tile-grey' },
};

/** Роль для проверки: один аккаунт смотрит продукт глазами любой из сторон. */
export const DemoScreen = ({ api, onSwitched }: DemoScreenProps) => {
  const roles = useBridgeRequest(() => api.demoRoles(), [api]);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (roles.loading && !roles.data) return <Skeleton count={5} />;

  if (roles.error || !roles.data) {
    return <Failure title="Роли не загрузились" error={roles.error} onRetry={roles.reload} />;
  }

  const take = async (role: DemoRoleView): Promise<void> => {
    if (role.current || busy !== null) return;

    setBusy(role.role);

    try {
      await api.takeDemoRole(role.role);
      toast(role.title);
      onSwitched();
    } catch (reason) {
      toast(describeFailure(reason), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="list">
      <CellList mode="island">
        {roles.data.map((role, index) => {
          const look = LOOKS[role.role];
          const Icon = look?.icon ?? IconPerson;

          return (
            <CellSimple
              key={role.role}
              before={
                <span className={`tile ${look?.tone ?? 'tile-grey'}`}>
                  <Icon />
                </span>
              }
              after={role.current ? <IconCheck /> : undefined}
              title={role.title}
              subtitle={busy === role.role ? 'Переключаем…' : role.about}
              separator={index > 0}
              onClick={() => void take(role)}
            />
          );
        })}
      </CellList>
    </section>
  );
};
