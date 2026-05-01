/**
 * @license
 * Copyright 2025 AlvaroBiano
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input, Message, Select, Spin, Typography } from '@arco-design/web-react';
import { Play, Check, Error, Timer, FileText } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MarkdownView from '@renderer/components/Markdown';
import styles from '../index.module.css';

interface TestRunnerProps {
  skillMarkdown: string;
  skillName: string;
  onComplete: (success: boolean, output: string) => void;
}

type TestStatus = 'idle' | 'running' | 'passed' | 'failed';

interface TestCase {
  id: string;
  name: string;
  input: string;
  expectedPattern?: string;
}

interface TestResult {
  caseId: string;
  status: TestStatus;
  output: string;
  duration: number;
  timestamp: Date;
}

const DEFAULT_TEST_CASES: TestCase[] = [
  {
    id: 'trigger-match',
    name: 'Trigger Matching',
    input: 'Test input that should match triggers',
    expectedPattern: 'trigger|keyword',
  },
  {
    id: 'content-render',
    name: 'Content Rendering',
    input: 'Show me how this skill renders its content',
    expectedPattern: '#',
  },
  {
    id: 'structure-valid',
    name: 'Structure Validation',
    input: 'Verify the skill has proper markdown structure',
    expectedPattern: '##',
  },
];

const TestRunner: React.FC<TestRunnerProps> = ({ skillMarkdown, skillName, onComplete }) => {
  const { t } = useTranslation();
  const [testCases, setTestCases] = useState<TestCase[]>(DEFAULT_TEST_CASES);
  const [results, setResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedCase, setSelectedCase] = useState<string | undefined>(undefined);
  const [customInput, setCustomInput] = useState('');

  // Run a single test case
  const runTestCase = useCallback(
    async (testCase: TestCase): Promise<TestResult> => {
      const startTime = Date.now();

      // Simulate test execution
      await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));

      let output = '';
      let status: TestStatus = 'passed';

      try {
        // Parse frontmatter to check if skill is valid
        const frontmatterMatch = skillMarkdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

        if (!frontmatterMatch) {
          output = '❌ Invalid frontmatter: No valid YAML frontmatter found';
          status = 'failed';
        } else {
          const [, frontmatterStr, contentPart] = frontmatterMatch;
          const meta: Record<string, string> = {};

          // Simple YAML parsing
          const lines = frontmatterStr.split('\n');
          for (const line of lines) {
            const keyMatch = line.match(/^(\w+):\s*(.+)/);
            if (keyMatch) {
              meta[keyMatch[1]] = keyMatch[2].replace(/^"|"$/g, '');
            }
          }

          // Validate required fields
          if (!meta.name && testCase.id === 'trigger-match') {
            output = '❌ Missing required field: name';
            status = 'failed';
          } else if (!meta.description && testCase.id === 'trigger-match') {
            output = '❌ Missing required field: description';
            status = 'failed';
          } else if (!contentPart && testCase.id === 'structure-valid') {
            output = '❌ No content after frontmatter';
            status = 'failed';
          } else {
            // Check if content has expected patterns
            const hasExpectedPattern =
              testCase.expectedPattern && new RegExp(testCase.expectedPattern).test(skillMarkdown);

            if (testCase.expectedPattern && !hasExpectedPattern) {
              output = `⚠️ Content does not match expected pattern: ${testCase.expectedPattern}`;
              status = 'failed';
            } else {
              output = `✅ Skill validation passed:\n`;
              output += `- Name: ${meta.name || '(not set)'}\n`;
              output += `- Description: ${meta.description || '(not set)'}\n`;
              output += `- Content length: ${contentPart.length} chars\n`;
              output += `- Has headers: ${contentPart.includes('##') ? 'Yes' : 'No'}\n`;
              status = 'passed';
            }
          }
        }
      } catch (error) {
        output = `❌ Error during test: ${error instanceof Error ? error.message : String(error)}`;
        status = 'failed';
      }

      const duration = Date.now() - startTime;

      return {
        caseId: testCase.id,
        status,
        output,
        duration,
        timestamp: new Date(),
      };
    },
    [skillMarkdown]
  );

  // Run all tests
  const runAllTests = useCallback(async () => {
    setIsRunning(true);
    setResults([]);

    const testResults: TestResult[] = [];

    for (const testCase of testCases) {
      const result = await runTestCase(testCase);
      testResults.push(result);
      setResults((prev) => [...prev, result]);
    }

    setIsRunning(false);

    const allPassed = testResults.every((r) => r.status === 'passed');
    onComplete(allPassed, testResults.map((r) => r.output).join('\n\n'));
  }, [testCases, runTestCase, onComplete]);

  // Run single test
  const runSingleTest = useCallback(
    async (testCaseId: string) => {
      const testCase = testCases.find((tc) => tc.id === testCaseId);
      if (!testCase) return;

      setIsRunning(true);
      const result = await runTestCase(testCase);
      setResults((prev) => [...prev.filter((r) => r.caseId !== testCaseId), result]);
      setIsRunning(false);
      onComplete(result.status === 'passed', result.output);
    },
    [testCases, runTestCase, onComplete]
  );

  // Run custom test
  const runCustomTest = useCallback(async () => {
    if (!customInput.trim()) {
      Message.warning(t('skillStudio.errors.customInputRequired', { defaultValue: 'Please enter test input' }));
      return;
    }

    setIsRunning(true);

    // Simulate custom test execution
    await new Promise((resolve) => setTimeout(resolve, 800));

    const triggers = skillMarkdown.match(/triggers:\n([\s\S]*?)(?:---|\n\n)/)?.[1] || '';
    const triggerWords = triggers
      .split('\n')
      .map((l) => l.replace(/^\s+-\s+/, '').trim())
      .filter(Boolean);

    const matchedTriggers = triggerWords.filter((t) =>
      customInput.toLowerCase().includes(t.toLowerCase())
    );

    let output = '';
    let status: TestStatus = 'passed';

    if (matchedTriggers.length > 0) {
      output = `✅ Found ${matchedTriggers.length} matching trigger(s):\n`;
      output += matchedTriggers.map((t) => `  - "${t}"`).join('\n');
    } else if (triggerWords.length > 0) {
      output = `ℹ️ No triggers matched, but skill has ${triggerWords.length} trigger(s) defined`;
      status = 'passed';
    } else {
      output = `⚠️ Skill has no triggers defined`;
      status = 'failed';
    }

    output += `\n\n📝 Test input: "${customInput}"`;
    output += `\n📄 Skill content preview:\n${skillMarkdown.slice(0, 200)}...`;

    const result: TestResult = {
      caseId: 'custom',
      status,
      output,
      duration: 800,
      timestamp: new Date(),
    };

    setResults((prev) => [...prev.filter((r) => r.caseId !== 'custom'), result]);
    setIsRunning(false);
    onComplete(status === 'passed', output);
  }, [customInput, skillMarkdown, runTestCase, onComplete, t]);

  // Get status icon
  const getStatusIcon = (status: TestStatus) => {
    switch (status) {
      case 'passed':
        return <Check theme='filled' size={16} className={styles.statusIconPassed} />;
      case 'failed':
        return <Error theme='filled' size={16} className={styles.statusIconFailed} />;
      case 'running':
        return <Spin size={14} />;
      default:
        return <Timer theme='outline' size={16} className={styles.statusIconIdle} />;
    }
  };

  const passedCount = results.filter((r) => r.status === 'passed').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;

  return (
    <div className={styles.testContainer}>
      {/* Test Controls */}
      <div className={styles.testControls}>
        <div className={styles.testHeader}>
          <h3 className={styles.testTitle}>
            <FileText theme='outline' size={16} />
            {t('skillStudio.testRunner', { defaultValue: 'Test Runner' })}
          </h3>
          <span className={styles.testSubtitle}>
            {skillName
              ? t('skillStudio.testingSkill', { defaultValue: 'Testing: {{name}}', name: skillName })
              : t('skillStudio.noSkillSelected', { defaultValue: 'No skill selected' })}
          </span>
        </div>

        {/* Action Buttons */}
        <div className={styles.testActions}>
          <Button
            type='primary'
            icon={<Play theme='outline' size={14} />}
            onClick={() => void runAllTests()}
            disabled={isRunning || !skillName}
            loading={isRunning && results.length === 0}
          >
            {t('skillStudio.runAll', { defaultValue: 'Run All Tests' })}
          </Button>

          <div className={styles.customTestInput}>
            <Input
              placeholder={t('skillStudio.customInputPlaceholder', {
                defaultValue: 'Enter custom test input...',
              })}
              value={customInput}
              onChange={setCustomInput}
              className={styles.customInput}
              disabled={isRunning}
            />
            <Button
              type='secondary'
              onClick={() => void runCustomTest()}
              disabled={isRunning || !customInput.trim()}
              loading={isRunning && results.some((r) => r.caseId === 'custom')}
            >
              {t('skillStudio.runCustom', { defaultValue: 'Test Custom Input' })}
            </Button>
          </div>
        </div>

        {/* Test Case Selection */}
        <div className={styles.testCaseSelect}>
          <Typography.Text className={styles.selectLabel}>
            {t('skillStudio.quickTest', { defaultValue: 'Quick Test' })}:
          </Typography.Text>
          <Select
            placeholder={t('skillStudio.selectTest', { defaultValue: 'Select a test case...' })}
            value={selectedCase}
            onChange={(value) => {
              setSelectedCase(value);
              if (value) {
                void runSingleTest(value);
              }
            }}
            disabled={isRunning}
            className={styles.testSelect}
          >
            {testCases.map((tc) => (
              <Select.Option key={tc.id} value={tc.id}>
                {tc.name}
              </Select.Option>
            ))}
          </Select>
        </div>
      </div>

      {/* Test Results Summary */}
      {results.length > 0 && (
        <div className={styles.testSummary}>
          <div className={styles.summaryItem}>
            <Check theme='filled' size={14} className={styles.summaryIconPassed} />
            <span>{t('skillStudio.passed', { defaultValue: 'Passed' })}: {passedCount}</span>
          </div>
          <div className={styles.summaryItem}>
            <Error theme='filled' size={14} className={styles.summaryIconFailed} />
            <span>{t('skillStudio.failed', { defaultValue: 'Failed' })}: {failedCount}</span>
          </div>
          <div className={styles.summaryItem}>
            <Timer theme='outline' size={14} className={styles.summaryIconIdle} />
            <span>
              {t('skillStudio.total', { defaultValue: 'Total' })}: {results.length}
            </span>
          </div>
        </div>
      )}

      {/* Test Results List */}
      <div className={styles.testResults}>
        <h4 className={styles.resultsTitle}>
          {t('skillStudio.testResults', { defaultValue: 'Test Results' })}
        </h4>
        {results.length === 0 ? (
          <div className={styles.noResults}>
            <Typography.Text type='secondary'>
              {t('skillStudio.noResults', {
                defaultValue: 'No test results yet. Run tests to see results here.',
              })}
            </Typography.Text>
          </div>
        ) : (
          <div className={styles.resultsList}>
            {results.map((result, index) => {
              const testCase = testCases.find((tc) => tc.id === result.caseId);
              return (
                <div key={`${result.caseId}-${index}`} className={styles.resultCard}>
                  <div className={styles.resultHeader}>
                    <div className={styles.resultTitle}>
                      {getStatusIcon(result.status)}
                      <span>{testCase?.name || t('skillStudio.customTest', { defaultValue: 'Custom Test' })}</span>
                    </div>
                    <div className={styles.resultMeta}>
                      <span className={styles.resultDuration}>{result.duration}ms</span>
                      <span className={styles.resultTime}>
                        {result.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                  <pre className={styles.resultOutput}>
                    <code>{result.output}</code>
                  </pre>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Skill Content Preview */}
      <div className={styles.skillPreview}>
        <h4 className={styles.previewTitle}>
          {t('skillStudio.skillContent', { defaultValue: 'Skill Content Being Tested' })}
        </h4>
        <div className={styles.skillPreviewContent}>
          <MarkdownView allowHtml>{skillMarkdown}</MarkdownView>
        </div>
      </div>
    </div>
  );
};

export default TestRunner;
