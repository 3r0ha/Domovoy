import { CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';

import { plural, tight, type DomovoyApi } from '../api.js';
import { CategoryTile } from './CategoryTile.js';
import { Group } from './Group.js';

export interface HouseRequestsProps {
  api: DomovoyApi;
  /** Открыть заявку соседа. */
  onOpen: (id: string) => void;
}

/**
 * Заявки дома, о которых сообщил сосед, с числом подтверждений.
 */
export const HouseRequests = ({ api, onOpen }: HouseRequestsProps) => {
  const house = useBridgeRequest(() => api.houseRequests(), [api]);
  const requests = Array.isArray(house.data) ? house.data : [];

  if (requests.length === 0) return null;

  return (
    <Group title="Заявки соседей">
      {requests.map((request, index) => (
        <CellSimple
          key={request.id}
          before={<CategoryTile category={request.category} title={request.categoryTitle} />}
          title={request.title}
          subtitle={`${tight(request.target)} · ${plural(request.reporters, 'сообщил', 'сообщили', 'сообщили')}`}
          showChevron
          separator={index > 0}
          onClick={() => onOpen(request.id)}
        />
      ))}
    </Group>
  );
};
