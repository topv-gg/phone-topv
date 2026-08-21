import { useEffect, type ReactNode } from 'react'
import { subscribePhoneHost } from './setupPhoneHost'

type PhoneHostProps = {
    children: ReactNode
}

export function PhoneHost({ children }: PhoneHostProps) {
    useEffect(() => {
        return subscribePhoneHost()
    }, [])

    return children
}
