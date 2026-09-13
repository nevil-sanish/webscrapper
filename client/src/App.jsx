import { useState, useEffect } from 'react'
import axios from 'axios'
import { Calendar, MapPin, ExternalLink, Trophy, Users } from 'lucide-react'

function App() {
  const [hackathons, setHackathons] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchHackathons = async () => {
      try {
        const response = await axios.get('http://localhost:5000/api/hackathons')
        setHackathons(response.data)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchHackathons()
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 p-8 text-gray-800 font-sans">
      <div className="max-w-7xl mx-auto">
        <header className="mb-12 text-center">
          <h1 className="text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 mb-4">
            Hackathon Aggregator
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Discover upcoming hackathons tailored for students, updated automatically.
          </p>
        </header>

        {loading && (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500"></div>
          </div>
        )}

        {error && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded shadow-md mb-8">
            <p className="font-bold">Error</p>
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {hackathons.map((h, index) => (
              <div 
                key={h._id || index} 
                className="bg-white rounded-xl shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden flex flex-col group border border-gray-100 relative"
              >
                {h.isKeralaRelevant && (
                  <div className="absolute top-4 right-4 bg-yellow-400 text-yellow-900 text-xs font-bold px-3 py-1 rounded-full flex items-center shadow-sm">
                    ⭐ Highly Relevant
                  </div>
                )}
                
                <div className="p-6 flex-grow">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2.5 py-0.5 rounded uppercase tracking-wide">
                      {h.source}
                    </span>
                  </div>
                  
                  <h2 className="text-2xl font-bold mb-3 text-gray-900 group-hover:text-blue-600 transition-colors">
                    {h.name}
                  </h2>
                  
                  <div className="space-y-3 mb-6 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-blue-500" />
                      <span>
                        {h.startDate ? new Date(h.startDate).toLocaleDateString() : 'TBA'} 
                        {h.endDate && ` - ${new Date(h.endDate).toLocaleDateString()}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-red-500" />
                      <span>{h.location || 'Online/Unknown'}</span>
                    </div>
                    {h.prize && (
                      <div className="flex items-center gap-2">
                        <Trophy className="w-4 h-4 text-yellow-500" />
                        <span className="truncate" title={h.prize}>{h.prize}</span>
                      </div>
                    )}
                    {h.eligibility && (
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-green-500" />
                        <span className="truncate" title={h.eligibility}>{h.eligibility}</span>
                      </div>
                    )}
                  </div>
                  
                  {h.tags && h.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {h.tags.slice(0, 3).map((tag, i) => (
                        <span key={i} className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded">
                          {tag}
                        </span>
                      ))}
                      {h.tags.length > 3 && (
                        <span className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded">
                          +{h.tags.length - 3} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-between items-center">
                  <span className="text-xs text-gray-500">
                    Added: {new Date(h.firstSeenAt).toLocaleDateString()}
                  </span>
                  <a 
                    href={h.sourceUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    View Details
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {!loading && !error && hackathons.length === 0 && (
          <div className="text-center text-gray-500 py-12">
            <p className="text-xl">No hackathons found.</p>
            <p>Run the scraper to populate the database!</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
