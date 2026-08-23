import { NextRequest, NextResponse } from 'next/server';
import { addOrUpdateActivity } from '@/lib/supabase';
import { ActionType } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { concert_id, user_name, action_type, comment_text, num1, num2, math_answer } = body;

    if (!concert_id || !user_name || !action_type) {
      return NextResponse.json({ error: 'Concert ID, user name, and action type are required.' }, { status: 400 });
    }

    const validActions: ActionType[] = ['INTERESTED', 'GOING', 'COMMENT', 'REMOVED'];
    if (!validActions.includes(action_type as ActionType)) {
      return NextResponse.json({ error: 'Invalid action type.' }, { status: 400 });
    }

    // Bot verification check
    if (typeof num1 === 'number' && typeof num2 === 'number' && math_answer !== undefined) {
      const expectedSum = num1 + num2;
      if (parseInt(math_answer, 10) !== expectedSum) {
        return NextResponse.json({ error: 'Anti-bot verification failed! Math answer is incorrect.' }, { status: 400 });
      }
    }

    const activity = await addOrUpdateActivity(
      concert_id,
      user_name,
      action_type as ActionType,
      comment_text
    );

    return NextResponse.json({ activity }, { status: 201 });
  } catch (error: any) {
    console.error('Error submitting activity:', error);
    return NextResponse.json({ error: error?.message || 'Failed to submit activity' }, { status: 500 });
  }
}
