import { describe, expect, it } from 'vitest';
import {
  messageForEvent,
  messageForSubstitution,
  messageForRuleChange,
  messageForEmergencySwap,
} from '@/lib/activity-feed';

describe('messageForEvent', () => {
  const base = {
    golferName: 'Rory McIlroy',
    round: 1,
    hole: 7,
    points: 1,
  } as const;

  it('birdie owned by viewer is good-tone and says "your pick"', () => {
    const m = messageForEvent({
      ...base,
      kind: 'birdie',
      ownedByViewer: true,
      otherOwners: [],
    });
    expect(m.tone).toBe('good');
    expect(m.message).toMatch(/Rory McIlroy/);
    expect(m.message).toMatch(/birdied hole 7/);
    expect(m.message).toMatch(/your pick/);
    expect(m.message).toMatch(/\+1 pts\.$/);
  });

  it('bogey not owned by viewer is bad-tone and names the other owner', () => {
    const m = messageForEvent({
      ...base,
      kind: 'bogey',
      points: -1,
      ownedByViewer: false,
      otherOwners: ['Ebbi'],
    });
    expect(m.tone).toBe('bad');
    expect(m.message).toMatch(/bogeyed/);
    expect(m.message).toMatch(/Ebbi's pick/);
    expect(m.message).toMatch(/-1 pts\.$/);
  });

  it('triple_plus mentions implosion', () => {
    const m = messageForEvent({
      ...base,
      kind: 'triple_plus',
      points: -5,
      ownedByViewer: true,
      otherOwners: [],
    });
    expect(m.emoji).toBe('💀');
    expect(m.message).toMatch(/imploded/i);
  });

  it('owned by viewer + one other owner reads "your pick + Ebbi\'s"', () => {
    const m = messageForEvent({
      ...base,
      kind: 'birdie',
      ownedByViewer: true,
      otherOwners: ['Ebbi'],
    });
    expect(m.message).toMatch(/your pick \+ Ebbi's/);
  });

  it('finish_1 has no hole number suffix', () => {
    const m = messageForEvent({
      golferName: 'Spieth',
      kind: 'finish_1',
      round: 0,
      hole: 0,
      points: 20,
      ownedByViewer: true,
      otherOwners: [],
    });
    expect(m.message).not.toMatch(/hole 0/);
    expect(m.message).toMatch(/WON the tournament/);
  });

  it('zero points event omits the points tag', () => {
    const m = messageForEvent({
      golferName: 'X',
      kind: 'missed_cut',
      round: 0,
      hole: 0,
      points: 0,
      ownedByViewer: true,
      otherOwners: [],
    });
    expect(m.message).not.toMatch(/pts/);
    expect(m.message).toMatch(/missed the cut/);
  });
});

describe('messageForSubstitution', () => {
  it('emits the swap arrow with day label', () => {
    const m = messageForSubstitution({
      participantName: 'Tryggvi',
      droppedGolferName: 'Rory',
      newGolferName: 'Spieth',
      window: 'day_1',
      costPoints: 0,
      isViewer: false,
    });
    expect(m.message).toBe('Tryggvi swapped Rory → Spieth after Day 1.');
  });

  it('uses "You" when isViewer is true', () => {
    const m = messageForSubstitution({
      participantName: 'Tryggvi',
      droppedGolferName: 'A',
      newGolferName: 'B',
      window: 'day_2',
      costPoints: 0,
      isViewer: true,
    });
    expect(m.message).toMatch(/^You/);
  });

  it('appends cost when nonzero', () => {
    const m = messageForSubstitution({
      participantName: 'X',
      droppedGolferName: 'A',
      newGolferName: 'B',
      window: 'day_2',
      costPoints: -3,
      isViewer: false,
    });
    expect(m.message).toMatch(/cost -3 pts/);
  });
});

describe('messageForRuleChange', () => {
  it('pending uses "proposed"', () => {
    const m = messageForRuleChange({
      proposerName: 'The creator',
      status: 'pending',
      summary: 'Triple+ edited',
      isViewer: false,
    });
    expect(m.message).toMatch(/proposed:/);
    expect(m.message).toMatch(/Triple\+ edited/);
  });

  it('approved uses approved-language', () => {
    const m = messageForRuleChange({
      proposerName: 'X',
      status: 'approved',
      summary: 'Bogey edited',
      isViewer: false,
    });
    expect(m.message).toMatch(/approved/i);
  });
});

describe('messageForEmergencySwap', () => {
  it('pending uses "requested"', () => {
    const m = messageForEmergencySwap({
      participantName: 'Wife',
      droppedGolferName: 'A. Fitzpatrick',
      newGolferName: 'M. Fitzpatrick',
      status: 'pending',
      isViewer: false,
    });
    expect(m.message).toMatch(/requested emergency swap/i);
    expect(m.message).toMatch(/A\. Fitzpatrick → M\. Fitzpatrick/);
  });

  it('approved uses applied-language', () => {
    const m = messageForEmergencySwap({
      participantName: 'X',
      droppedGolferName: 'A',
      newGolferName: 'B',
      status: 'approved',
      isViewer: false,
    });
    expect(m.message).toMatch(/applied/i);
  });
});
