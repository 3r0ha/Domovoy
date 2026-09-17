import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-test/**',
      'node_modules/**',
      // Форк проверяется правилами апстрима, а не нашими.
      'packages/max-bot-api/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.lint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Необработанный промис в обработчике события, самый частый способ потерять ошибку.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      // Реализация асинхронного интерфейса синхронным кодом, норма, а не ошибка.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  {
    // Правила хуков ловят то, что типы не видят: пропущенные зависимости эффектов
    // и вызовы хуков под условием.
    files: [
      'packages/react/src/**/*.ts',
      'packages/react/src/**/*.tsx',
      'landing/src/**/*.ts',
      'landing/src/**/*.tsx',
    ],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  {
    // Ядро правил ни от чего не зависит: иначе тарифы или сроки в один день
    // окажутся зависимыми от базы, и проверить их без неё станет нельзя.
    files: ['packages/domain/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@domovoy/*', '@maxkit/*'], message: 'Доменное ядро не зависит ни от чего' }] },
      ],
    },
  },

  {
    // Сценарии знают правила и порты, но не знают ни HTTP, ни бота, ни базы:
    // адаптеры подключаются к ним, а не наоборот.
    files: ['packages/app/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@domovoy/api', '@domovoy/bot', '@domovoy/storage', '@maxkit/*'],
              message: 'Слой сценариев не знает своих адаптеров',
            },
          ],
        },
      ],
    },
  },

  {
    // Размер и сложность меряются в рабочем коде. В тестах длинный describe это норма,
    // а восклицательный знак на фикстуре короче проверки, которая всё равно упала бы.
    files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx', 'apps/*/src/**/*.ts', 'apps/*/src/**/*.tsx'],
    rules: {
      'max-lines-per-function': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 20],
      'max-depth': ['error', 4],
    },
  },

  {
    // Файл области, это список регистраций маршрутов подряд. Предел здесь выше,
    // но он есть: за четырьмя сотнями строк область пора делить дальше.
    files: ['apps/api/src/routes/*.ts'],
    rules: { 'max-lines-per-function': ['error', { max: 400, skipBlankLines: true, skipComments: true }] },
  },

  {
    // Демонстрационные данные и сквозной прогон это сценарий, записанный подряд:
    // резать его на функции значит терять читаемость истории.
    files: ['apps/domovoy/src/demo.ts', 'apps/domovoy/src/walkthrough.ts'],
    rules: { 'max-lines-per-function': 'off' },
  },

  {
    // Долг по размеру и сложности. Список сокращается по мере разбора файлов
    // и существует затем, чтобы предел действовал на весь остальной код.
    files: [
      'apps/api/src/server.ts',
      'apps/domovoy/src/main.ts',
      'apps/miniapp/src/screens/*.tsx',
      'packages/app/src/debt.ts',
      'packages/app/src/setup.ts',
      'packages/bridge/src/mock.ts',
      'packages/platform-mock/src/handler.ts',
      'packages/runtime/src/client.ts',
    ],
    rules: { 'max-lines-per-function': 'off', complexity: 'off' },
  },

  {
    // Скрипты стенда живут вне проектов TypeScript: правила с типами к ним неприменимы.
    files: ['**/*.mjs'],
    languageOptions: {
      parserOptions: { project: null, projectService: false },
      globals: { ...globals.node },
    },
    rules: { ...tseslint.configs.disableTypeChecked.rules, 'no-console': 'off' },
  },

  {
    // Точка сборки и служебные команды, то немногое, чему положено разговаривать с оператором.
    files: ['apps/domovoy/src/main.ts', 'apps/domovoy/src/cli.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['**/test/**/*.ts', '**/test/**/*.tsx'],
    rules: {
      // describe и it из node:test возвращают промисы по своему устройству,
      // ожидать их не нужно, иначе правило даёт сотни ложных срабатываний.
      '@typescript-eslint/no-floating-promises': 'off',
      // В тестах допустимы утверждения о типах и обращение к внутренностям двойников.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/unbound-method': 'off',
      // Двойники воспроизводят протокол клиента, который бросает объекты, а не Error.
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
    },
  },
);
