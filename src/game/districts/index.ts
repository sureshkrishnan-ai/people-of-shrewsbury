// Registers every built district (import once, early). The default comes from the city config.
// People of City's hand-built Bengaluru districts (./koramangala, ./hsr) stay in the tree as the
// foundation's examples, but aren't registered in this fork.
import { startDistrict } from '@/city/config'
import './realmap'
import { activateDistrict } from './active'

activateDistrict(startDistrict())
