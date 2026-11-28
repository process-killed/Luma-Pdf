/** Quiz steps: render the question, grade the answer, explain it. */
import { renderRichText } from './model.js';

export function createQuizView(quiz, { onAnswer } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'gp-quiz';
  wrap.dataset.kind = quiz.kind;

  const head = document.createElement('div');
  head.className = 'gp-quiz-head';
  head.innerHTML = '<span class="gp-quiz-badge">Quiz</span>';
  wrap.append(head);

  const q = document.createElement('p');
  q.className = 'gp-quiz-question';
  q.textContent = quiz.question || 'Question';
  wrap.append(q);

  let read = () => null;
  const options = document.createElement('div');
  options.className = 'gp-quiz-options';

  if (quiz.kind === 'short') {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input gp-quiz-input';
    input.placeholder = 'Type your answer';
    input.setAttribute('aria-label', 'Your answer');
    options.append(input);
    read = () => input.value;
  } else {
    const list = quiz.kind === 'boolean' ? ['True', 'False'] : quiz.options;
    list.forEach((label, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gp-quiz-option';
      btn.dataset.index = String(index);
      btn.innerHTML = `<span class="gp-quiz-dot" aria-hidden="true"></span><span>${escapeHtml(label || `Option ${index + 1}`)}</span>`;
      btn.addEventListener('click', () => {
        options.querySelectorAll('.gp-quiz-option').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
      });
      options.append(btn);
    });
    read = () => {
      const chosen = options.querySelector('.gp-quiz-option[aria-pressed="true"]');
      return chosen ? Number(chosen.dataset.index) : null;
    };
  }
  wrap.append(options);

  const footer = document.createElement('div');
  footer.className = 'gp-quiz-footer';
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'btn btn-primary btn-sm';
  submit.textContent = 'Check answer';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'btn btn-ghost btn-sm';
  skip.textContent = 'Skip';
  footer.append(submit, skip);
  wrap.append(footer);

  const feedback = document.createElement('div');
  feedback.className = 'gp-quiz-feedback';
  feedback.setAttribute('role', 'status');
  feedback.hidden = true;
  wrap.append(feedback);

  const grade = (value) => {
    if (quiz.kind === 'short') {
      const expected = String(quiz.answer || '').trim().toLowerCase();
      const given = String(value || '').trim().toLowerCase();
      return { correct: !!expected && given === expected, expected };
    }
    return { correct: Number(value) === Number(quiz.answer), expected: quiz.answer };
  };

  submit.addEventListener('click', () => {
    const value = read();
    if (value === null || value === '') {
      feedback.hidden = false;
      feedback.className = 'gp-quiz-feedback is-warn';
      feedback.textContent = 'Choose an answer first.';
      return;
    }
    const { correct } = grade(value);
    feedback.hidden = false;
    feedback.className = `gp-quiz-feedback ${correct ? 'is-correct' : 'is-wrong'}`;
    feedback.innerHTML = `<strong>${correct ? 'Correct' : 'Not quite'}</strong>${quiz.explanation ? renderRichText(quiz.explanation) : ''}`;
    options.querySelectorAll('button, input').forEach((el) => { el.disabled = true; });
    submit.disabled = true;
    onAnswer?.({ correct, value });
  });

  skip.addEventListener('click', () => onAnswer?.({ correct: null, skipped: true }));

  return {
    el: wrap,
    focus: () => options.querySelector('button, input')?.focus(),
    answer: read
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
