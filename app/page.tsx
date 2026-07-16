'use client';

import { SubmitEvent, useState } from 'react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, userQuery })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to scrape');
        return;
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 min-h-screen p-4">
      <div className="w-full max-w-2xl">
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl p-8">
          <h1 className="text-4xl font-bold text-black dark:text-white mb-2">
            AI Web Scraper
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mb-8">
            Extract structured data from any website using AI
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Website URL
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                required
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                What data to extract?
              </label>
              <textarea
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder="e.g., Extract all product names, prices, and descriptions"
                required
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-800 dark:text-white resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-3 rounded-lg transition-colors duration-200"
            >
              {loading ? 'Scraping...' : 'Scrape Website'}
            </button>
          </form>

          {error && (
            <div className="mt-8 p-4 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded-lg">
              <p className="text-red-800 dark:text-red-100 font-semibold">Error:</p>
              <p className="text-red-700 dark:text-red-200">{error}</p>
            </div>
          )}

          {result && (
            <div className="mt-8">
              <h2 className="text-xl font-bold text-black dark:text-white mb-4">Results</h2>
              
              {result.schemaGenerated && (
                <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900 rounded-lg border border-blue-200 dark:border-blue-700">
                  <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">Generated Schema:</h3>
                  <pre className="text-sm text-blue-800 dark:text-blue-200 overflow-auto max-h-48">
                    {JSON.stringify(result.schemaGenerated, null, 2)}
                  </pre>
                </div>
              )}

              {result.data && (
                <div className="p-4 bg-green-50 dark:bg-green-900 rounded-lg border border-green-200 dark:border-green-700">
                  <h3 className="font-semibold text-green-900 dark:text-green-100 mb-2">Extracted Data:</h3>
                  <pre className="text-sm text-green-800 dark:text-green-200 overflow-auto max-h-48">
                    {JSON.stringify(result.data, null, 2)}
                  </pre>
                </div>
              )}

              <button
                onClick={() => setResult(null)}
                className="mt-4 w-full bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 rounded-lg transition-colors duration-200"
              >
                Clear Results
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
